# Why Rack Alone Isn't Enough

We've spent several chapters demonstrating that you can build real web applications with nothing but Rack and Ruby's standard library. This is true. It's also incomplete.

Rack gives you a protocol. What it doesn't give you is a productive way to work at scale. Let's be precise about what's missing.

## The Problems That Show Up

### Problem 1: Routing Gets Ugly

Our hand-rolled router is workable for small applications. When an application grows to dozens of routes, a flat list of `(method, pattern, handler)` tuples becomes difficult to maintain.

Consider a typical CRUD application:

```ruby
# GET  /projects
# POST /projects
# GET  /projects/:id
# PUT  /projects/:id
# DELETE /projects/:id
# GET  /projects/:id/tasks
# POST /projects/:id/tasks
# GET  /projects/:id/tasks/:task_id
# PUT  /projects/:id/tasks/:task_id
# DELETE /projects/:id/tasks/:task_id
# GET  /projects/:id/collaborators
# POST /projects/:id/collaborators
# DELETE /projects/:id/collaborators/:user_id
```

Thirteen routes. For one resource with two nested sub-resources. A medium-sized application might have ten resources with similar nesting. That's over a hundred routes.

The flat list approach requires you to repeat the `:id` pattern in every route. It requires you to duplicate the `/projects/:id` prefix for every nested resource. When you change the prefix, you update dozens of patterns. When you forget one, you get a routing inconsistency.

More specifically: our flat router has no concept of shared route segments. Every route is independent. The information that `/projects/:id/tasks` and `/projects/:id/collaborators` both belong to the same project is not represented anywhere.

### Problem 2: Before/After Actions Are Awkward

In Rails:

```ruby
class ProjectsController < ApplicationController
  before_action :authenticate!
  before_action :find_project, only: [:show, :update, :destroy]
  before_action :require_admin, only: [:destroy]
  
  def show
    render json: @project
  end
end
```

In bare Rack, you'd write this as:
- A middleware that handles authentication (fine)
- Code in each route handler that loads the project (repetitive)
- A conditional check in the delete handler (manual)

You can build before-action systems — they're just arrays of procs called before the handler. But nothing in Rack provides this scaffolding. You write it yourself, every time.

### Problem 3: Response Helpers Don't Exist

```ruby
# In a framework
render json: @user, status: :created

# In bare Rack
body = @user.to_json
[201, {'Content-Type' => 'application/json', 'Content-Length' => body.bytesize.to_s}, [body]]
```

The framework version is shorter because the framework accumulated helper methods over time. `render json:` is syntactic sugar over exactly what the Rack version does. The sugar exists because you'd type the verbose version hundreds of times in a real application.

### Problem 4: Configuration Seeps Everywhere

A bare Rack app has no natural place to put application-level configuration:

```ruby
# Where does the database connection go?
# Where does the template engine get configured?
# Where do shared helpers live?
# Where does the application secret key live?
```

In Rails, the answer to all of these is "the application object and its configuration." In Sinatra, it's `set :key, value` and `settings.key`. In bare Rack, you figure it out yourself, and the answer is "some combination of globals, constants, and thread locals."

### Problem 5: Template Rendering Is Your Problem

The Rack spec says nothing about templates. If you want ERB or Haml or Mustache, you call the library directly:

```ruby
require 'erb'

template = ERB.new(File.read('views/users.html.erb'))
html = template.result(binding)  # dangerous: binding exposes entire scope
[200, {'Content-Type' => 'text/html'}, [html]]
```

This works for one template. For a real application, you need:
- A way to find template files by name
- Layout support (a template inside a master template)
- Partials (including sub-templates)
- Content type detection
- Safe access to view helpers without exposing everything via `binding`

Frameworks provide this. Bare Rack does not.

## The Two Solutions

There are two ways to address these problems:

**Solution A: Add exactly what you need, nothing more.** Write a before-action system that handles your application's specific needs. Use a router library that handles the routing problem but nothing else. Add a template helper that handles the two template engines you actually use. Build up from Rack exactly as far as you need.

This is the Sinatra approach. Sinatra is a small framework that solves the routing and template problems while staying thin everywhere else. It works well for APIs and small web applications.

**Solution B: Start with a minimal framework that has correct abstractions, then opt into features as you need them.** Rather than building up from primitives, start with a framework that already has the right foundation, and enable features through a plugin system.

This is the Roda approach.

## Where Sinatra Falls Short

Sinatra solves the routing problem with a flat DSL:

```ruby
get '/projects' do
  # ...
end

get '/projects/:id' do
  id = params[:id]
  # ...
end
```

But it inherits the flat-list problem. As an application grows, Sinatra routes become hard to organize. Sinatra's routing is sequential — the first matching route wins, and the routes are just checked in order. For large applications with complex routing, this can be surprisingly slow, and there's no structural way to represent the hierarchical nature of the URL namespace.

Sinatra also doesn't solve the "shared prefix" problem. If you rename `/projects` to `/p`, you update every route that starts with `/projects`.

## What a Better Abstraction Looks Like

The insight that Roda is built on: **the URL hierarchy is a tree, and your routing should be a tree too.**

Instead of a flat list of routes:
```
GET  /projects           → list_projects
POST /projects           → create_project
GET  /projects/:id       → show_project
PUT  /projects/:id       → update_project
DELETE /projects/:id     → delete_project
```

...you write a tree:

```
/projects
  GET  → list_projects
  POST → create_project
  /:id
    GET    → show_project
    PUT    → update_project
    DELETE → delete_project
    /tasks
      GET  → list_tasks
      POST → create_task
```

When a request comes in for `DELETE /projects/42`, you traverse the tree:
1. Does the path start with `/projects`? Yes. Consume it.
2. Is there a `:id` segment? `42`. Consume it.
3. Nothing remaining. Match on `DELETE`. Run the handler.

The tree represents the actual structure of your URL namespace. The `/projects` prefix is stated once. The `:id` parameter is extracted once and available to all nested routes.

This is what Roda implements. It calls it a "routing tree," and it's the framework's central design decision.

## Why This Matters for Performance

Sinatra's routing has O(n) complexity — in the worst case, it checks every route until it finds a match. For an application with 200 routes, a request to the last-defined route or a 404 checks all 200 patterns.

Roda's tree routing has O(log n) complexity roughly — it traverses the tree, discarding entire branches when the path prefix doesn't match. A request for `/projects/42` immediately discards everything that doesn't start with `/projects`, then everything within `/projects` that doesn't match `/42` or `/:id`. The routing work is proportional to the depth of the match, not the total number of routes.

For most applications, this difference is imperceptible. For high-traffic applications or applications with many routes, it matters.

## What Roda Is

Roda is a small Ruby web framework built on Rack with:
- Tree-based routing
- A plugin system that lets you add features (sessions, template rendering, JSON helpers, CSRF protection) without pulling in everything at once
- Correct Rack integration throughout
- A minimal footprint when you use minimal plugins

It was created by Jeremy Evans (also the author of Sequel, the Ruby database toolkit) and is used in production by applications that process millions of requests per day.

It is not Rails. It doesn't have an ORM, a mailer, an asset pipeline, or conventions for where to put files. It has routing and a plugin system. You add what you need.

Next: let's look at how that routing tree actually works.
