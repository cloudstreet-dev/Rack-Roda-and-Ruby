# What Rails and Sinatra Are Actually Doing

Now that you know HTTP is text, let's talk about what happens between "the server receives bytes" and "your route handler runs." This is the part that frameworks describe as magic. It isn't.

## The Stack

When an HTTP request hits a Rails or Sinatra application, it passes through several layers before your code sees it:

1. The HTTP server (Puma, WEBrick, Unicorn) accepts a TCP connection and parses raw HTTP text into a structured Ruby hash.
2. That hash gets passed through Rack middleware — a chain of objects that can inspect, modify, or halt the request before it reaches your application.
3. Your application receives the (possibly modified) hash, runs your route handler, and returns a status code, headers, and body.
4. The response travels back up through the middleware chain.
5. The server serializes the response into HTTP text and writes it to the socket.

You control step 3. Rack owns step 2. The server owns steps 1, 4, and 5.

Here's the thing: steps 1 and 3 are what vary between server choices and framework choices. Steps 2 and 4 — the middleware chain — use the same protocol regardless of whether you're using Rails, Sinatra, Roda, or a handwritten Rack app.

## Let's Look at Rails

```ruby
# Gemfile
gem 'rails'

# config.ru (every Rails app has this)
require_relative 'config/environment'
run Rails.application
```

That `run Rails.application` line is the whole story. `run` is a Rack method that calls your object's `call` method for every request. `Rails.application` is a callable.

We can inspect what Rails actually does:

```ruby
# In a Rails console
middleware_stack = Rails.application.middleware

middleware_stack.each do |middleware|
  puts middleware.inspect
end
```

You'll see something like:

```
#<ActionDispatch::HostAuthorization ...>
#<Rack::Sendfile ...>
#<ActionDispatch::Static ...>
#<ActionDispatch::Executor ...>
#<ActiveSupport::Cache::Strategy::LocalCache::Middleware ...>
#<Rack::Runtime ...>
#<Rack::MethodOverride ...>
#<ActionDispatch::RequestId ...>
#<ActionDispatch::RemoteIp ...>
#<Sprockets::Rails::QuietAssets ...>
#<Rails::Rack::Logger ...>
#<ActionDispatch::ShowExceptions ...>
#<ActionDispatch::DebugExceptions ...>
#<ActionDispatch::ActionableExceptions ...>
#<ActionDispatch::Reloader ...>
#<ActionDispatch::Callbacks ...>
#<ActiveRecord::Migration::CheckPending ...>
#<ActionDispatch::Cookies ...>
#<ActionDispatch::Session::CookieStore ...>
#<ActionDispatch::Flash ...>
#<ActionDispatch::ContentSecurityPolicy::Middleware ...>
#<ActionDispatch::PermissionsPolicy::Middleware ...>
#<Rack::Head ...>
#<Rack::ConditionalGet ...>
#<Rack::ETag ...>
#<Rack::TempfileReaper ...>
```

That's over twenty pieces of middleware wrapping your application before a single request reaches your router. Most of them are doing something useful. `Rack::MethodOverride` is what makes `_method=DELETE` in form submissions work. `ActionDispatch::Session::CookieStore` is where sessions come from. `Rack::ETag` generates ETags for conditional GET responses.

At the very bottom of that stack is your router, which dispatches to controllers, which call your code. The router is also just a callable.

## Let's Look at Sinatra

Sinatra is simpler, which makes it easier to see the structure:

```ruby
require 'sinatra/base'

class MyApp < Sinatra::Base
  get '/' do
    'Hello, World!'
  end
end
```

`Sinatra::Base` is a Rack application. It has a `call` method. When you write:

```ruby
get '/' do
  'Hello, World!'
end
```

...you're adding a route to a routing table that lives inside the `call` method. The `call` method looks at the env hash, extracts the HTTP method and path, finds a matching route, and calls your block.

Here's a rough but accurate implementation of what Sinatra's routing core does:

```ruby
class TinySinatra
  def initialize
    @routes = {}
  end

  def get(path, &handler)
    @routes[['GET', path]] = handler
  end

  def post(path, &handler)
    @routes[['POST', path]] = handler
  end

  def call(env)
    method = env['REQUEST_METHOD']
    path   = env['PATH_INFO']

    handler = @routes[[method, path]]

    if handler
      body = handler.call
      [200, {'Content-Type' => 'text/html'}, [body]]
    else
      [404, {'Content-Type' => 'text/plain'}, ['Not Found']]
    end
  end
end
```

That's not a joke. Sinatra's actual implementation is more sophisticated (regex matching, parameter extraction, before/after filters, error handling, template rendering), but the structure is exactly this: a hash of routes, a `call` method that looks things up in the hash.

Let's verify it works:

```ruby
app = TinySinatra.new
app.get('/') { 'Hello!' }
app.get('/about') { 'About page.' }

# Simulate what a Rack server does
env = {
  'REQUEST_METHOD' => 'GET',
  'PATH_INFO'      => '/',
  'rack.input'     => StringIO.new,
}

status, headers, body = app.call(env)
puts status    # 200
puts body      # ["Hello!"]

env['PATH_INFO'] = '/missing'
status, headers, body = app.call(env)
puts status    # 404
```

## What Frameworks Actually Add

Now we can be precise about what you're paying for when you use a framework:

**Rails adds:**
- A routing DSL that handles parameters, constraints, and named routes
- Controllers with before/after actions, strong parameters, response helpers
- ActiveRecord (this alone is most of the value proposition)
- View rendering with template engines and layouts
- Asset pipeline
- A massive middleware stack with sensible defaults
- Conventions that allow code generation and eliminate boilerplate
- A very large community and ecosystem

**Sinatra adds:**
- A routing DSL (simpler than Rails's)
- Filters (before/after handlers)
- Template rendering
- A small, optional middleware stack
- Much less convention, more flexibility

**What neither adds, because Rack already provides it:**
- The protocol for receiving requests and returning responses
- The ability to run on any conforming server
- The middleware interface

This is why you can swap Puma for Unicorn without changing your application. This is why you can write middleware that works in both Rails and Sinatra apps. This is why a Rack app can be embedded inside a Rails app, and a Rails app can be mounted inside a Rack app. They all speak the same protocol.

## The Middleware Chain Is Composable

Here's something you can do in Rails that will make the structure visible:

```ruby
# config/application.rb
module MyApp
  class Application < Rails::Application
    # Add our own middleware at the front of the stack
    config.middleware.use LoggingMiddleware

    # Add middleware after a specific existing one
    config.middleware.insert_after ActionDispatch::Flash, CustomMiddleware

    # Remove middleware we don't need
    config.middleware.delete Rack::Runtime
  end
end
```

And here's a middleware that you could add to Rails, Sinatra, or a bare Rack app without modification:

```ruby
class LoggingMiddleware
  def initialize(app)
    @app = app
  end

  def call(env)
    start = Time.now
    status, headers, body = @app.call(env)
    elapsed = Time.now - start

    puts "[#{status}] #{env['REQUEST_METHOD']} #{env['PATH_INFO']} (#{elapsed.round(4)}s)"

    [status, headers, body]
  end
end
```

This is not framework-specific code. It's Rack code. It works because both Rails and Sinatra are Rack applications, and this is a Rack middleware.

## The Call Stack

When a request comes in, execution looks like this:

```
Server.call(env)
  LoggingMiddleware.call(env)
    Rack::Session::Cookie.call(env)
      Rack::MethodOverride.call(env)
        YourApplication.call(env)
          # Your route runs here
          # Returns [200, headers, body]
        # MethodOverride gets [200, headers, body]
      # Session middleware gets [200, headers, body]
    # Logging middleware gets [200, headers, body]
  # Server sends the response
```

Each layer wraps the next. Each layer can modify the request env before passing it down, and modify the response before passing it up. The pattern is: wrap the inner app, call it, do something with the result.

This is just function composition, with objects instead of functions. If you've worked with function pipelines in Elixir or middleware in Express.js, it's the same idea.

## Why This Matters for You

When something goes wrong in a web application, it happens at one of these layers:

- The server layer: connection issues, SSL errors, timeout behavior
- The middleware layer: session corruption, cookie issues, CSRF failures, content encoding problems
- The routing layer: 404s, parameter parsing, path matching
- The application layer: your actual code

When you don't know these layers exist, every bug is mysterious. When you do, you can narrow it down quickly. Is the bug in your code, or is it in the middleware below your code? Add a middleware that logs the env before your code runs. Is the response wrong, or is a middleware above you rewriting it? Log the response after your code runs.

The tools for this kind of debugging are available to you the moment you understand that your application is wrapped in a stack of callables.

That's what frameworks are doing. They're arranging callables in a useful order and providing defaults that most applications need. The next step is to look at the protocol that makes all of this possible.
