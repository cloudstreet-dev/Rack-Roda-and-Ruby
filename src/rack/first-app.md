# Your First Rack App (No Training Wheels)

Let's build a Rack application that actually does something. Not a "hello world" one-liner, but a proper small application with routing, multiple responses, and request handling. We'll do it without a framework, using only the `rack` gem and Ruby's standard library.

## Setup

```bash
mkdir rack-from-scratch
cd rack-from-scratch
bundle init
```

Add to your `Gemfile`:

```ruby
gem 'rack'
```

```bash
bundle install
```

## The Application

We're going to build a small API that manages a list of notes. In-memory storage, no database, no ORM. Just a hash and some Rack.

```ruby
# app.rb
require 'json'

class NotesApp
  def initialize
    @notes = {}
    @next_id = 1
  end

  def call(env)
    method = env['REQUEST_METHOD']
    path   = env['PATH_INFO']

    case [method, path]
    when ['GET', '/notes']
      list_notes
    when ['POST', '/notes']
      create_note(env)
    else
      # Match /notes/123
      if (match = path.match(%r{\A/notes/(\d+)\z}))
        id = match[1].to_i
        case method
        when 'GET'    then show_note(id)
        when 'DELETE' then delete_note(id)
        else method_not_allowed
        end
      else
        not_found
      end
    end
  end

  private

  def list_notes
    json_response(200, @notes.values)
  end

  def show_note(id)
    note = @notes[id]
    return not_found unless note
    json_response(200, note)
  end

  def create_note(env)
    body = env['rack.input'].read
    data = JSON.parse(body)

    note = {
      'id'      => @next_id,
      'content' => data['content'].to_s,
      'created' => Time.now.iso8601,
    }

    @notes[@next_id] = note
    @next_id += 1

    json_response(201, note)
  rescue JSON::ParserError
    json_response(400, {'error' => 'Invalid JSON'})
  end

  def delete_note(id)
    return not_found unless @notes.key?(id)
    @notes.delete(id)
    [204, {}, []]
  end

  def not_found
    json_response(404, {'error' => 'Not found'})
  end

  def method_not_allowed
    json_response(405, {'error' => 'Method not allowed'})
  end

  def json_response(status, data)
    body = JSON.generate(data)
    [
      status,
      {
        'Content-Type'   => 'application/json',
        'Content-Length' => body.bytesize.to_s,
      },
      [body]
    ]
  end
end
```

```ruby
# config.ru
require_relative 'app'

run NotesApp.new
```

Start it:

```bash
$ bundle exec rackup
Puma starting in single mode...
* Puma version: 6.x
* Min threads: 0, max threads: 5
* Listening on http://127.0.0.1:9292
```

## Using It

```bash
# Create a note
$ curl -s -X POST http://localhost:9292/notes \
  -H 'Content-Type: application/json' \
  -d '{"content": "Rack is just a contract"}' | jq .
{
  "id": 1,
  "content": "Rack is just a contract",
  "created": "2026-02-19T12:00:00+00:00"
}

# Create another
$ curl -s -X POST http://localhost:9292/notes \
  -H 'Content-Type: application/json' \
  -d '{"content": "env is just a hash"}' | jq .
{
  "id": 2,
  "content": "env is just a hash",
  "created": "2026-02-19T12:00:01+00:00"
}

# List all notes
$ curl -s http://localhost:9292/notes | jq .
[
  {"id": 1, "content": "Rack is just a contract", "created": "..."},
  {"id": 2, "content": "env is just a hash", "created": "..."}
]

# Get one note
$ curl -s http://localhost:9292/notes/1 | jq .
{"id": 1, "content": "Rack is just a contract", "created": "..."}

# Delete a note
$ curl -s -X DELETE http://localhost:9292/notes/1
# 204 No Content, empty body

# Confirm deletion
$ curl -s http://localhost:9292/notes/1 | jq .
{"error": "Not found"}

# Invalid JSON
$ curl -s -X POST http://localhost:9292/notes \
  -H 'Content-Type: application/json' \
  -d 'not json' | jq .
{"error": "Invalid JSON"}
```

This is a functional REST API. No framework. No router gem. About 80 lines of Ruby.

## What We're Missing

This is a good moment to notice what we haven't done:

**No request parsing helpers.** We read `env['rack.input'].read` directly and parsed JSON ourselves. For URL-encoded form data, we'd need to parse `name=value&other=thing` ourselves, or reach for `Rack::Utils.parse_query`.

**No URL helpers.** We matched routes with a `case` statement and regex. This works but doesn't scale gracefully.

**No content negotiation.** We ignore the client's `Accept` header. A real API should check whether the client wants JSON before sending JSON.

**No error handling for the whole app.** If something explodes with an unexpected exception, Rack's handler returns a 500 with a generic page. We'd want to catch and format that ourselves.

**No middleware.** No logging, no session handling, no CORS headers.

These aren't criticisms — they're deliberate omissions to keep the example clear. For production, you'd add them, or use a framework that provides them as defaults.

## Adding Rack's Own Helpers

The `rack` gem includes utilities you can use without a framework. Let's use a couple:

```ruby
require 'json'
require 'rack'

class NotesApp
  def call(env)
    request = Rack::Request.new(env)

    method = request.request_method
    path   = request.path_info

    # Parse query parameters automatically
    page = request.params['page']&.to_i || 1

    # Check content type on POST
    if request.post? && !request.content_type&.include?('application/json')
      return json_response(415, {'error' => 'Content-Type must be application/json'})
    end

    # ... rest of routing ...
  end
end
```

`Rack::Request` wraps the env hash and provides methods like:
- `request.get?`, `request.post?`, `request.delete?`
- `request.path_info` — same as `env['PATH_INFO']`
- `request.params` — merged GET and POST params, URL-decoded
- `request.body.read` — the request body
- `request.content_type`
- `request.cookies` — parsed cookie hash
- `request.xhr?` — true if it's an XMLHttpRequest
- `request.ip` — client IP address

And `Rack::Response` for building responses:

```ruby
def json_response(status, data)
  body = JSON.generate(data)
  response = Rack::Response.new
  response.status = status
  response['Content-Type'] = 'application/json'
  response.write(body)
  response.finish  # returns [status, headers, body]
end
```

These are thin wrappers around the same env hash and response array. They don't add framework overhead — they add ergonomics.

## Writing a Test

Because this is plain Ruby, testing is straightforward. You don't need a test server. You just call `call` with a fake env:

```ruby
# test_app.rb
require 'minitest/autorun'
require 'json'
require 'rack/mock'
require_relative 'app'

class TestNotesApp < Minitest::Test
  def setup
    @app = NotesApp.new
  end

  def test_empty_list
    status, headers, body = get('/notes')
    assert_equal 200, status
    assert_equal 'application/json', headers['Content-Type']
    assert_equal [], JSON.parse(body.join)
  end

  def test_create_note
    status, headers, body = post('/notes', '{"content": "test note"}')
    assert_equal 201, status
    data = JSON.parse(body.join)
    assert_equal 'test note', data['content']
    assert data['id']
  end

  def test_show_note
    _, _, body = post('/notes', '{"content": "hello"}')
    id = JSON.parse(body.join)['id']

    status, _, body = get("/notes/#{id}")
    assert_equal 200, status
    assert_equal 'hello', JSON.parse(body.join)['content']
  end

  def test_not_found
    status, _, body = get('/notes/999')
    assert_equal 404, status
    assert_equal 'Not found', JSON.parse(body.join)['error']
  end

  def test_delete_note
    _, _, body = post('/notes', '{"content": "delete me"}')
    id = JSON.parse(body.join)['id']

    status, _, _ = delete("/notes/#{id}")
    assert_equal 204, status

    status, _, _ = get("/notes/#{id}")
    assert_equal 404, status
  end

  private

  def get(path)
    env = Rack::MockRequest.env_for(path, method: 'GET')
    @app.call(env)
  end

  def post(path, body)
    env = Rack::MockRequest.env_for(path,
      method: 'POST',
      input: body,
      'CONTENT_TYPE' => 'application/json'
    )
    @app.call(env)
  end

  def delete(path)
    env = Rack::MockRequest.env_for(path, method: 'DELETE')
    @app.call(env)
  end
end
```

`Rack::MockRequest.env_for` builds a valid Rack env hash for testing purposes. Run it:

```bash
$ ruby test_app.rb
Run options: --seed 12345

# Running:

.....

Finished in 0.001s, 4000.0 runs/s.
5 runs, 8 assertions, 0 failures, 0 errors, 0 skips
```

Five tests, sub-millisecond runtime, no HTTP server, no magic. The application is a Ruby object. You test it like one.

## The Insight

Here's the moment this chapter promised:

**A web application is a function.** It takes input (the env hash) and returns output (status, headers, body). Testing it is exactly as easy as testing any other function. The fact that it handles HTTP is incidental to what it actually is: an object with a `call` method.

This is why Rack applications are easy to compose, easy to test, and easy to reason about. The framework complexity you're accustomed to isn't inherent to web development — it's a response to problems that arise at scale. At small scale, or with the right tools, you don't always need it.

Next: let's build the thing that calls your app — the server itself.
