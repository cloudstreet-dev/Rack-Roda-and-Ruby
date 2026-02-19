# Middleware in Roda

Roda is a Rack application. Everything we said about Rack middleware in Part II applies directly. But Roda also has opinions about how middleware should be organized, and it introduces a couple of patterns that are worth understanding.

## Using Rack Middleware with Roda

Standard Rack middleware works identically with Roda as with any other Rack application:

```ruby
class App < Roda
  use Rack::Deflater          # gzip compression
  use Rack::Session::Cookie,  # sessions (Rack's version, not Roda's)
    secret: ENV['SESSION_SECRET']

  route do |r|
    r.get 'hello' do
      'Hello, World!'
    end
  end
end
```

`use` is inherited from Rack::Builder and adds middleware to the stack that wraps your Roda application. These middlewares run before any Roda routing.

## Middleware vs. Plugins

Roda has two mechanisms for adding cross-cutting behavior: Rack middleware and Roda plugins. The choice matters.

**Use Rack middleware for:**
- Behavior that applies to all Rack applications uniformly (compression, request logging)
- Third-party middleware that doesn't know about Roda
- Middleware that needs to run before Roda even sees the request

**Use Roda plugins for:**
- Behavior that needs access to Roda's routing context
- Features that need to know about sessions, current user, or other application state
- Authentication and authorization that should happen within routes

The practical difference: middleware runs before Roda creates a request context. Plugins run inside that context. If your authentication middleware needs to set a `current_user` that your routes can access, you need a plugin, because middleware has no access to the Roda application instance.

## The middleware Plugin

Roda includes a `middleware` plugin that lets you use a Roda app as middleware inside another Roda app:

```ruby
# api_app.rb
class ApiApp < Roda
  plugin :json
  plugin :middleware  # makes this usable as middleware

  route do |r|
    r.on 'api' do
      r.get 'status' do
        {'status' => 'ok', 'app' => 'api'}
      end
    end
  end
end

# web_app.rb
class WebApp < Roda
  use ApiApp  # ApiApp handles /api/* requests, passes others through

  route do |r|
    r.get '/' do
      'Main web app'
    end
  end
end
```

When `ApiApp` receives a request that doesn't match any of its routes, it calls the next application in the stack (the `@app` in standard middleware terms). This is what the `middleware` plugin adds — the pass-through behavior.

Without `plugin :middleware`, a Roda app that doesn't match a route returns 404. With it, the app passes the request to the next layer.

## Building an Auth Middleware in Roda Style

Here's a common pattern: an authentication middleware that sets the current user in the env, which is then read by the application's plugin:

```ruby
# middleware/authenticate.rb
class Authenticate
  def initialize(app, header: 'HTTP_AUTHORIZATION')
    @app    = app
    @header = header
  end

  def call(env)
    token = env[@header]&.sub('Bearer ', '')

    if token
      user = User.find_by_token(token)
      env['current_user'] = user if user
    end

    @app.call(env)
  end
end
```

```ruby
# plugins/current_user.rb
module Roda::RodaPlugins::CurrentUser
  module InstanceMethods
    def current_user
      # Read from env, set by the middleware
      env['current_user']
    end

    def require_authenticated!
      r.halt(401, {'error' => 'Authentication required'}) unless current_user
    end

    def require_admin!
      require_authenticated!
      r.halt(403, {'error' => 'Forbidden'}) unless current_user.admin?
    end
  end
end
```

```ruby
# app.rb
class App < Roda
  use Authenticate  # runs before Roda, populates env['current_user']

  plugin :json
  plugin :halt
  plugin :current_user  # reads env['current_user'] in route context

  route do |r|
    r.get 'public' do
      'No auth required'
    end

    r.on 'private' do
      require_authenticated!  # from plugin

      r.get 'data' do
        {'user' => current_user.name, 'data' => [1, 2, 3]}
      end
    end

    r.on 'admin' do
      require_admin!  # from plugin

      r.get 'users' do
        User.all
      end
    end
  end
end
```

The middleware handles authentication (token verification, user lookup). The plugin provides ergonomic access to the result within Roda's context. Clean separation of concerns.

## Conditional Middleware

Because Roda is a class and `use` is a class method, you can conditionally load middleware:

```ruby
class App < Roda
  use Rack::Deflater                    # always compress
  use RequestLogger if $stdout.tty?    # log to console in development
  use Sentry::Rack::CaptureExceptions  # error tracking in production

  route do |r|
    # ...
  end
end
```

Or based on environment:

```ruby
class App < Roda
  if ENV['RACK_ENV'] == 'development'
    use Rack::Lint   # validates Rack compliance
    use BetterErrors::Middleware, allow_ip: '127.0.0.1'
  end

  route do |r|
    # ...
  end
end
```

## Middleware Ordering with Roda

The middleware ordering rules from Part II still apply, but Roda adds one consideration: plugins that modify request or response handling (like `sessions` or `csrf`) run inside the Roda instance, after all Rack middleware. Rack-level session middleware runs before Roda; Roda's session plugin runs inside Roda.

This means you shouldn't mix Rack session middleware with Roda's session plugin:

```ruby
# Don't do this
class App < Roda
  use Rack::Session::Cookie, secret: 'secret1'  # Rack-level sessions
  plugin :sessions, secret: 'secret2'           # Roda-level sessions
  # They'll conflict — two different session stores
end

# Do this instead
class App < Roda
  plugin :sessions, secret: ENV['SESSION_SECRET']  # Roda handles sessions
end
```

Roda's session plugin uses a slightly different cookie format than `Rack::Session::Cookie`, so if you're migrating from a Rack session setup, you'll need to handle the transition carefully.

## Inspecting the Middleware Stack

To see what middleware is in your stack:

```ruby
# In a Rack app or Rails console
App.middleware.each { |m| p m }
```

Or at the Rack level:

```ruby
# config.ru
require_relative 'app'

# Introspect before running
puts "Middleware stack:"
app = App
while app.respond_to?(:app)
  puts "  #{app.class}"
  app = app.app
end

run App
```

In production, it's worth auditing your middleware stack. Every middleware is code that runs for every request. If you have middleware you're not using, remove it.

## The Right Mental Model

Think of a Roda application as three nested layers:

```
[Rack middleware layer]
  Rack::Deflater
  YourAuthMiddleware
  Rack::RequestId
    ↓ env hash passes through here
[Roda routing layer]
  plugin :sessions reads/writes cookies
  plugin :csrf validates tokens
  r.on / r.is / r.get match paths and methods
    ↓ reaches your route block
[Your application layer]
  current_user
  business logic
  data access
```

Middleware is for infrastructure concerns that don't need to know they're running in Roda. Plugins are for application concerns that benefit from Roda's routing context.

When you're unsure which to use: if it needs access to `session`, `current_user`, or any Roda-specific context, it's a plugin. If it treats the request as an opaque Rack env hash, it's middleware.

Next: testing Roda applications, which is one of the genuine pleasures of this stack.
