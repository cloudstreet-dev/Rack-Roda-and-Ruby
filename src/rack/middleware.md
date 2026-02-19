# Middleware: Turtles All the Way Down

Middleware is the most overloaded term in web development. In Rack's context, it has a precise meaning: a middleware is a Rack application that wraps another Rack application.

That's it. An object with a `call` method that receives an inner app in its initializer, delegates to it, and adds some behavior before or after (or instead of) that delegation.

## The Pattern

```ruby
class MyMiddleware
  def initialize(app)
    @app = app
  end

  def call(env)
    # Do something before the inner app runs
    
    status, headers, body = @app.call(env)
    
    # Do something after the inner app runs
    
    [status, headers, body]
  end
end
```

This is the complete middleware pattern. Everything else is elaboration.

The `initialize` method receives the next application in the chain. The `call` method can:
- Inspect or modify `env` before passing it down
- Decide not to call `@app` at all (short-circuit)
- Inspect or modify the `[status, headers, body]` before returning it up
- Call `@app` multiple times (for retry logic)
- Do work in a separate thread (for async logging)

## A Real Example: Request Logging

```ruby
class RequestLogger
  def initialize(app, logger: $stdout)
    @app    = app
    @logger = logger
  end

  def call(env)
    start  = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    method = env['REQUEST_METHOD']
    path   = env['PATH_INFO']
    
    status, headers, body = @app.call(env)
    
    elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - start
    ms = (elapsed * 1000).round(1)

    @logger.puts "[#{Time.now.strftime('%H:%M:%S')}] #{method} #{path} → #{status} (#{ms}ms)"

    [status, headers, body]
  end
end
```

Use it:

```ruby
# config.ru
require_relative 'app'
require_relative 'request_logger'

use RequestLogger
run NotesApp.new
```

Now every request is logged:

```
[12:00:00] GET /notes → 200 (0.3ms)
[12:00:01] POST /notes → 201 (0.8ms)
[12:00:02] GET /notes/1 → 200 (0.2ms)
[12:00:03] DELETE /notes/1 → 204 (0.1ms)
[12:00:04] GET /notes/999 → 404 (0.1ms)
```

The application knows nothing about this. `NotesApp` didn't change. The logging behavior is composed around it.

## A Real Example: Authentication

```ruby
class BasicAuth
  def initialize(app, realm:, credentials:)
    @app         = app
    @realm       = realm
    @credentials = credentials  # { username => password }
  end

  def call(env)
    auth = env['HTTP_AUTHORIZATION']

    if auth && auth.start_with?('Basic ')
      encoded = auth.sub('Basic ', '')
      username, password = Base64.decode64(encoded).split(':', 2)

      if @credentials[username] == password
        # Auth success — pass through to the app
        env['authenticated_user'] = username
        return @app.call(env)
      end
    end

    # Auth failed — short-circuit, don't call the inner app
    [
      401,
      {
        'Content-Type'     => 'text/plain',
        'WWW-Authenticate' => "Basic realm=\"#{@realm}\"",
      },
      ['Unauthorized']
    ]
  end
end
```

Use it:

```ruby
# config.ru
require 'base64'
require_relative 'app'
require_relative 'basic_auth'

use BasicAuth,
  realm: 'Notes API',
  credentials: { 'admin' => 'secret' }

run NotesApp.new
```

Now:

```bash
# No credentials
$ curl -s http://localhost:9292/notes
Unauthorized

# Wrong password
$ curl -s -u admin:wrong http://localhost:9292/notes
Unauthorized

# Correct credentials
$ curl -s -u admin:secret http://localhost:9292/notes
[]
```

The inner app still knows nothing about authentication. `NotesApp` didn't change. Authentication is entirely handled in the middleware layer.

## A Real Example: Response Time Header

```ruby
class ResponseTime
  HEADER = 'X-Response-Time'.freeze

  def initialize(app)
    @app = app
  end

  def call(env)
    start = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    status, headers, body = @app.call(env)
    elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - start

    headers[HEADER] = "#{(elapsed * 1000).round(2)}ms"

    [status, headers, body]
  end
end
```

This modifies the *response* rather than the request. It adds a header after the inner app runs.

## Composing Multiple Middlewares

When you `use` multiple middlewares in `config.ru`, they nest:

```ruby
# config.ru
use ResponseTime
use RequestLogger
use BasicAuth, realm: 'Notes', credentials: { 'user' => 'pass' }
run NotesApp.new
```

The call stack for a request is:

```
ResponseTime.call(env)
  RequestLogger.call(env)
    BasicAuth.call(env)
      NotesApp.call(env)    # only if auth passes
    BasicAuth returns [status, headers, body]
  RequestLogger returns [status, headers, body] (after logging)
ResponseTime returns [status, headers, body] (after adding X-Response-Time)
```

The first `use` is the outermost layer. The `run` is the innermost. Middleware added first wraps everything else.

This has a non-obvious implication: **`RequestLogger` runs inside `ResponseTime`**. If `RequestLogger` adds 0.1ms of overhead, that overhead is included in the response time that `ResponseTime` measures. Whether that's what you want depends on what you're measuring.

## Building a Middleware Stack Manually

`Rack::Builder` (what `config.ru` uses) is just a class that builds a chain of middlewares. We can do it manually to see the structure:

```ruby
require_relative 'app'
require_relative 'request_logger'
require_relative 'response_time'

# Build the stack by hand — innermost to outermost
inner  = NotesApp.new
logged = RequestLogger.new(inner)
timed  = ResponseTime.new(logged)

# timed is the outermost app — this is what the server calls
status, headers, body = timed.call(env)
```

Or using `Rack::Builder` directly:

```ruby
app = Rack::Builder.new do
  use ResponseTime
  use RequestLogger
  run NotesApp.new
end

# app.call(env) now goes through the whole stack
```

`Rack::Builder` does exactly what we did manually — it builds a chain of closures, each wrapping the next.

## Middleware from the Rack Gem

The `rack` gem ships with a set of useful middlewares:

```ruby
# Adds X-Runtime header (response time)
use Rack::Runtime

# Rewrites POST bodies with _method=DELETE to DELETE requests
use Rack::MethodOverride

# Adds ETag and Last-Modified for conditional GET support
use Rack::ConditionalGet
use Rack::ETag

# Compresses responses with gzip when client supports it
use Rack::Deflater

# Serves static files from ./public
use Rack::Static, urls: ['/assets'], root: 'public'

# Basic request/response logging
use Rack::CommonLogger

# Cookie-based sessions
use Rack::Session::Cookie, secret: 'your_secret_key'
```

These are all just implementations of the same pattern: initialize with `app`, implement `call`.

## Middleware Order Matters

```ruby
# WRONG order: Static serves before auth check
use Rack::Static, urls: ['/admin/files']
use BasicAuth, realm: 'Admin'
run AdminApp.new

# RIGHT order: Auth runs first, wraps everything including Static
use BasicAuth, realm: 'Admin'
use Rack::Static, urls: ['/admin/files']
run AdminApp.new
```

In the wrong order, requests to `/admin/files/secret.pdf` bypass authentication because `Rack::Static` intercepts them before `BasicAuth` gets a chance to check credentials.

This kind of bug is especially fun to debug when you inherited the codebase.

## Conditional Middleware

Sometimes you want middleware only in certain environments:

```ruby
# config.ru
if ENV['RACK_ENV'] == 'development'
  use Rack::Lint       # validates Rack compliance — catches your bugs
  use RequestLogger
end

use Rack::Session::Cookie, secret: ENV.fetch('SESSION_SECRET')
run MyApp.new
```

`Rack::Lint` is particularly useful during development — it validates that your app and middleware are conforming to the spec and raises helpful errors when they don't.

## Writing Middleware That Passes Options

A common pattern is passing configuration at use-time:

```ruby
class RateLimiter
  def initialize(app, limit: 100, window: 60)
    @app    = app
    @limit  = limit
    @window = window
    @counts = Hash.new(0)
    @mutex  = Mutex.new
  end

  def call(env)
    ip = env['REMOTE_ADDR']

    @mutex.synchronize do
      @counts[ip] += 1

      if @counts[ip] > @limit
        return [
          429,
          {'Content-Type' => 'text/plain', 'Retry-After' => @window.to_s},
          ['Too Many Requests']
        ]
      end
    end

    @app.call(env)
  end
end

# In config.ru:
use RateLimiter, limit: 50, window: 30
```

The `initialize` arguments after `app` are the middleware's configuration options. `Rack::Builder` passes them through when you write `use RateLimiter, limit: 50`.

## The Insight

Here's what took me too long to realize: **middleware is just objects calling other objects.** There's no framework magic. There's no DSL. There's no reflection or code generation. It's a chain of Ruby objects where each one holds a reference to the next and delegates to it.

When you understand this, you can:
- Read any middleware and understand it immediately
- Write middleware that does exactly what you need
- Debug middleware issues by temporarily removing layers
- Understand why middleware order matters

The entire Rack ecosystem — gems, frameworks, servers — is built on this pattern. A Rails app with 20 middlewares is just 20 objects arranged in a chain. When something goes wrong in that chain, you now know how to find it.

Next: what those middlewares are usually protecting — your routing.
