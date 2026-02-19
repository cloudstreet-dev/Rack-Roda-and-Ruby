# Your First Roda App

Theory is good. Working code is better. Let's build a complete Roda application that handles real concerns: routing, data handling, JSON responses, error handling, and a structure you could actually extend.

We'll build the same Notes API from the Rack chapter, but with Roda. Then we'll add things that would have been painful in bare Rack.

## Setup

```bash
mkdir roda-notes
cd roda-notes
bundle init
```

```ruby
# Gemfile
gem 'roda'
gem 'json'
```

```bash
bundle install
```

## The Basic Application

```ruby
# app.rb
require 'roda'
require 'json'

class NotesApp < Roda
  plugin :json           # Automatically serialize return values to JSON
  plugin :json_parser    # Parse JSON request bodies into r.params
  plugin :halt           # Allow r.halt for early exits
  plugin :all_verbs      # Support PUT, PATCH, DELETE in routes

  NOTES  = {}
  NEXT_ID = [1]  # Array so we can mutate it (class vars are awkward)

  route do |r|
    r.on 'notes' do

      # GET /notes - list all notes
      # POST /notes - create a note
      r.is do
        r.get do
          NOTES.values
        end

        r.post do
          content = r.params['content'].to_s
          r.halt(422, {'error' => 'content is required'}) if content.empty?

          id   = NEXT_ID[0]
          note = {'id' => id, 'content' => content, 'created' => Time.now.iso8601}
          NOTES[id] = note
          NEXT_ID[0] += 1

          response.status = 201
          note
        end
      end

      r.on Integer do |id|
        note = NOTES[id]
        r.halt(404, {'error' => 'Note not found'}) unless note

        # GET /notes/:id
        # DELETE /notes/:id
        r.is do
          r.get    { note }
          r.delete do
            NOTES.delete(id)
            response.status = 204
            ''
          end
        end
      end

    end
  end
end
```

```ruby
# config.ru
require_relative 'app'
run NotesApp
```

Notice that the routing block returns the note hash directly — not a Rack response array. The `json` plugin intercepts the return value and serializes it. This is Roda's plugin system at work.

## Running It

```bash
$ bundle exec rackup
Puma starting in single mode...
* Listening on http://127.0.0.1:9292
```

```bash
$ curl -s -X POST http://localhost:9292/notes \
  -H 'Content-Type: application/json' \
  -d '{"content": "First note"}' | jq .
{"id":1,"content":"First note","created":"2026-02-19T12:00:00+00:00"}

$ curl -s http://localhost:9292/notes | jq .
[{"id":1,"content":"First note","created":"..."}]

$ curl -s http://localhost:9292/notes/1 | jq .
{"id":1,"content":"First note","created":"..."}

$ curl -s -X DELETE http://localhost:9292/notes/1
# 204, empty body

$ curl -s http://localhost:9292/notes/1 | jq .
{"error":"Note not found"}
```

## Adding Structure

As the application grows, the single route block gets large. The natural Roda approach is to extract routes into methods:

```ruby
class NotesApp < Roda
  plugin :json
  plugin :json_parser
  plugin :halt
  plugin :all_verbs

  NOTES   = {}
  NEXT_ID = [1]

  route do |r|
    r.on 'notes' do
      r.is    { notes_collection(r) }
      r.on Integer do |id|
        note = find_note!(id)
        r.is { note_resource(r, note, id) }
      end
    end
  end

  private

  def find_note!(id)
    NOTES[id] || r.halt(404, {'error' => 'Note not found'})
  end

  def notes_collection(r)
    r.get  { NOTES.values }
    r.post { create_note(r) }
  end

  def note_resource(r, note, id)
    r.get    { note }
    r.delete { delete_note(id) }
  end

  def create_note(r)
    content = r.params['content'].to_s
    r.halt(422, {'error' => 'content is required'}) if content.empty?

    id   = NEXT_ID[0]
    note = {'id' => id, 'content' => content, 'created' => Time.now.iso8601}
    NOTES[id] = note
    NEXT_ID[0] += 1

    response.status = 201
    note
  end

  def delete_note(id)
    NOTES.delete(id)
    response.status = 204
    ''
  end
end
```

Now the `route` block is a compact index of what routes exist, and the implementation details are in named methods.

## A More Complete Example: Multi-Resource API

Let's extend the application to handle two resources: notes and tags. Notes can have tags.

```ruby
# app.rb
require 'roda'
require 'json'
require 'securerandom'

class App < Roda
  plugin :json
  plugin :json_parser
  plugin :halt
  plugin :all_verbs
  plugin :status_handler

  # Return appropriate errors for 404 and 405
  status_handler(404) { {'error' => 'Not found'} }
  status_handler(405) { {'error' => 'Method not allowed'} }

  # In-memory storage (replace with a real database in production)
  STORE = {
    notes: {},
    tags:  {},
    next_note_id: [1],
    next_tag_id:  [1],
  }

  route do |r|
    r.on 'tags' do
      r.is do
        r.get  { STORE[:tags].values }
        r.post { create_tag(r) }
      end

      r.on Integer do |id|
        tag = STORE[:tags][id]
        r.halt(404) unless tag

        r.is do
          r.get    { tag }
          r.delete { STORE[:tags].delete(id); response.status = 204; '' }
        end
      end
    end

    r.on 'notes' do
      r.is do
        r.get do
          # Support filtering by tag: GET /notes?tag=ruby
          if (tag_name = r.params['tag'])
            STORE[:notes].values.select { |n| n['tags'].include?(tag_name) }
          else
            STORE[:notes].values
          end
        end

        r.post { create_note(r) }
      end

      r.on Integer do |id|
        note = STORE[:notes][id]
        r.halt(404) unless note

        r.is do
          r.get    { note }
          r.put    { update_note(r, note) }
          r.delete { STORE[:notes].delete(id); response.status = 204; '' }
        end

        r.on 'tags' do
          r.is do
            r.get { note['tags'] }

            r.post do
              tag_name = r.params['name'].to_s
              r.halt(422, {'error' => 'name required'}) if tag_name.empty?
              note['tags'] |= [tag_name]  # union — no duplicates
              note['tags']
            end
          end

          r.on String do |tag_name|
            r.is do
              r.delete do
                note['tags'].delete(tag_name)
                response.status = 204
                ''
              end
            end
          end
        end
      end
    end
  end

  private

  def create_note(r)
    content = r.params['content'].to_s
    r.halt(422, {'error' => 'content is required'}) if content.empty?

    id = STORE[:next_note_id][0]
    STORE[:next_note_id][0] += 1

    note = {
      'id'      => id,
      'content' => content,
      'tags'    => [],
      'created' => Time.now.iso8601,
      'updated' => Time.now.iso8601,
    }
    STORE[:notes][id] = note
    response.status = 201
    note
  end

  def update_note(r, note)
    note['content'] = r.params['content'].to_s if r.params['content']
    note['updated'] = Time.now.iso8601
    note
  end

  def create_tag(r)
    name = r.params['name'].to_s
    r.halt(422, {'error' => 'name is required'}) if name.empty?

    id = STORE[:next_tag_id][0]
    STORE[:next_tag_id][0] += 1

    tag = {'id' => id, 'name' => name}
    STORE[:tags][id] = tag
    response.status = 201
    tag
  end
end
```

Try it:

```bash
# Create some notes
curl -s -X POST http://localhost:9292/notes \
  -H 'Content-Type: application/json' \
  -d '{"content": "Rack is a protocol"}' | jq .id

curl -s -X POST http://localhost:9292/notes \
  -H 'Content-Type: application/json' \
  -d '{"content": "Roda uses tree routing"}' | jq .id

# Tag note 1
curl -s -X POST http://localhost:9292/notes/1/tags \
  -H 'Content-Type: application/json' \
  -d '{"name": "rack"}'

curl -s -X POST http://localhost:9292/notes/1/tags \
  -H 'Content-Type: application/json' \
  -d '{"name": "ruby"}'

# Tag note 2
curl -s -X POST http://localhost:9292/notes/2/tags \
  -H 'Content-Type: application/json' \
  -d '{"name": "roda"}'

curl -s -X POST http://localhost:9292/notes/2/tags \
  -H 'Content-Type: application/json' \
  -d '{"name": "ruby"}'

# Filter by tag
curl -s 'http://localhost:9292/notes?tag=ruby' | jq 'map(.content)'
# ["Rack is a protocol", "Roda uses tree routing"]

curl -s 'http://localhost:9292/notes?tag=rack' | jq 'map(.content)'
# ["Rack is a protocol"]

# Remove a tag
curl -s -X DELETE http://localhost:9292/notes/1/tags/ruby
# 204

curl -s 'http://localhost:9292/notes?tag=ruby' | jq 'map(.content)'
# ["Roda uses tree routing"]
```

## What Roda Added

Compare this to the bare Rack version from two chapters ago:

**What got better:**
- `r.halt(404)` instead of manually building `[404, {...}, [...]]`
- Return values are automatically serialized as JSON (no manual `JSON.generate` + headers)
- `r.params` automatically parsed JSON body (no `JSON.parse(env['rack.input'].read)`)
- The routing structure mirrors the URL structure exactly
- Database lookup (well, hash lookup) happens once for nested routes

**What's still our responsibility:**
- Input validation
- Error responses
- Storage (we're still using an in-memory hash)
- Authentication, authorization

**What Roda didn't add that we didn't ask for:**
- Database integration
- Template rendering
- Sessions (unless we add the plugin)
- CSRF protection (unless we add the plugin)

This is Roda's philosophy. The framework gives you routing and the infrastructure to opt into more. You add what you need.

## The route Block Is Just Ruby

The most important thing to understand about Roda's routing is that the `route` block is plain Ruby code that runs for every request. There's no pre-compilation step, no route table generation at startup, no metaprogramming magic at call time.

When a request comes in for `GET /notes/42`, Roda:
1. Creates a new instance of your application class
2. Calls the `route` block (via `instance_exec`) with the request object
3. The block runs, evaluating `r.on 'notes'` (which matches), then `r.on Integer` (which matches `42`), then `r.is` (which matches the end), then `r.get` (which matches the method)
4. The return value of the block is the response

It's that mechanical. There's no magic routing table. The routing tree is expressed as a Ruby block, and the block runs as Ruby code.

This means you can do things in routes that you can't do in a static routing table:

```ruby
route do |r|
  # Routing based on configuration
  if FEATURES[:new_api]
    r.on 'api/v2' do
      # new API routes
    end
  end

  # Routing based on request data
  r.on 'api' do
    if r.env['HTTP_X_API_VERSION'] == '2'
      # version 2 handlers
    else
      # version 1 handlers
    end
  end

  # Dynamic routing (be careful with this)
  r.on String do |segment|
    page = Page.find_by_slug(segment)
    r.halt(404) unless page
    page.content
  end
end
```

The route block is code. Use it like code.

## What to Read Next

Now that you have a working Roda app, the next things to explore are:
1. The plugin system — how to add features without the framework imposing them
2. Middleware integration — how Roda works with Rack middleware
3. Testing — which is genuinely pleasant, for reasons we'll get to

All of that is next.
