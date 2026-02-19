# Routing Without a Framework (It's Just String Matching)

Routing is the process of mapping an incoming HTTP request to a handler. Frameworks make this look sophisticated. It isn't. It's string matching with some parameter extraction.

Let's implement a router from scratch, then look at what frameworks add on top.

## What Routing Actually Is

Given a request with `METHOD = "GET"` and `PATH_INFO = "/users/42/posts"`, routing finds the code that should handle it. The two inputs are the HTTP method and the path. The outputs are: either "run this code" or "404."

That's the whole problem. Everything else is ergonomics.

## The Simplest Router

From the previous chapter's NotesApp, we had:

```ruby
case [method, path]
when ['GET', '/notes']
  list_notes
when ['POST', '/notes']
  create_note(env)
end
```

This is a router. It matches on method and exact path. The problem: it doesn't handle path parameters (`/notes/42`).

## Path Parameters via Regex

```ruby
class Router
  def initialize
    @routes = []
  end

  def add(method, pattern, &handler)
    # Convert /users/:id/posts to a regex with named captures
    regex = pattern.gsub(/:(\w+)/, '(?<\1>[^/]+)')
    regex = Regexp.new("\\A#{regex}\\z")
    @routes << {method: method, pattern: regex, handler: handler}
  end

  def get(path, &block)  = add('GET',    path, &block)
  def post(path, &block) = add('POST',   path, &block)
  def put(path, &block)  = add('PUT',    path, &block)
  def patch(path, &block)= add('PATCH',  path, &block)
  def delete(path, &block)=add('DELETE', path, &block)

  def call(env)
    method = env['REQUEST_METHOD']
    path   = env['PATH_INFO']

    @routes.each do |route|
      next unless route[:method] == method
      next unless (match = route[:pattern].match(path))

      # Extract named captures as string keys
      params = match.named_captures
      env['router.params'] = params

      return route[:handler].call(env, params)
    end

    [404, {'Content-Type' => 'text/plain'}, ['Not Found']]
  end
end
```

Using it:

```ruby
router = Router.new

router.get('/') do |env, params|
  [200, {'Content-Type' => 'text/plain'}, ['Welcome']]
end

router.get('/users/:id') do |env, params|
  [200, {'Content-Type' => 'text/plain'}, ["User #{params['id']}"]]
end

router.get('/users/:user_id/posts/:id') do |env, params|
  body = "Post #{params['id']} by user #{params['user_id']}"
  [200, {'Content-Type' => 'text/plain'}, [body]]
end

router.post('/users') do |env, params|
  # Create a user...
  [201, {'Content-Type' => 'text/plain'}, ['Created']]
end
```

Test it:

```ruby
require 'rack/mock'

def request(router, method, path)
  env = Rack::MockRequest.env_for(path, method: method)
  status, _, body = router.call(env)
  [status, body.join]
end

puts request(router, 'GET',  '/')                          # [200, "Welcome"]
puts request(router, 'GET',  '/users/42')                  # [200, "User 42"]
puts request(router, 'GET',  '/users/42/posts/7')          # [200, "Post 7 by user 42"]
puts request(router, 'POST', '/users')                     # [201, "Created"]
puts request(router, 'GET',  '/nonexistent')               # [404, "Not Found"]
```

## The Regex Trick

The pattern translation deserves a closer look:

```ruby
pattern = '/users/:id/posts/:post_id'

# Step 1: Replace :param with a named capture group
regex_str = pattern.gsub(/:(\w+)/, '(?<\1>[^/]+)')
# => "/users/(?<id>[^/]+)/posts/(?<post_id>[^/]+)"

# Step 2: Anchor it
regex = Regexp.new("\\A#{regex_str}\\z")
# => /\A\/users\/(?<id>[^\/]+)\/posts\/(?<post_id>[^\/]+)\z/

# Test it
match = regex.match('/users/42/posts/7')
match.named_captures   # => {"id"=>"42", "post_id"=>"7"}
```

`[^/]+` matches one or more characters that aren't a slash — which is what a URL segment is. Named captures (the `?<name>` syntax) let us extract those values by name.

This is what every Ruby routing library does underneath. Some add wildcard matching (`*path`), optional segments (`(/edit)?`), or format matching (`.json`). The core is always the same regex transform.

## Constraint-Based Routing

Rails routes support constraints like `id: /\d+/`. We can add that:

```ruby
def add(method, pattern, constraints: {}, &handler)
  # Build base regex, replacing :param with a named capture
  regex_str = pattern.gsub(/:(\w+)/) do |match|
    param_name = $1
    # Use constraint regex if provided, otherwise match any non-slash chars
    param_pattern = constraints[param_name.to_sym]&.source || '[^/]+'
    "(?<#{param_name}>#{param_pattern})"
  end

  regex = Regexp.new("\\A#{regex_str}\\z")
  @routes << {method: method, pattern: regex, handler: handler}
end

# Usage: only match numeric IDs
router.get('/users/:id', constraints: {id: /\d+/}) do |env, params|
  [200, {}, ["User #{params['id']}"]]
end

# This matches:   GET /users/42
# This doesn't:   GET /users/alice
```

## Mounting Rack Apps at Paths

Routing isn't just about handlers — you can route to entire Rack applications:

```ruby
class PathRouter
  def initialize
    @mounts = []
    @routes = []
  end

  def mount(path, app)
    @mounts << {prefix: path, app: app}
  end

  def call(env)
    path = env['PATH_INFO']

    # Check mounts first — rewrite PATH_INFO for the mounted app
    @mounts.each do |mount|
      if path.start_with?(mount[:prefix])
        env = env.merge(
          'SCRIPT_NAME' => env['SCRIPT_NAME'] + mount[:prefix],
          'PATH_INFO'   => path.sub(mount[:prefix], '') || '/',
        )
        return mount[:app].call(env)
      end
    end

    # Then check plain routes
    # ... (same as before)
    
    [404, {'Content-Type' => 'text/plain'}, ['Not Found']]
  end
end

# Example:
router = PathRouter.new
router.mount('/api/v1', ApiApp.new)
router.mount('/admin', AdminApp.new)
```

This is exactly how Rails's `mount` directive works. `SCRIPT_NAME` tracks how much of the path has been consumed by the routing layer, and `PATH_INFO` contains the remaining path for the mounted app to interpret.

## A Full-Featured Example

Let's build a complete router that a small real application could actually use:

```ruby
# router.rb
class Router
  Route = Struct.new(:method, :pattern, :named_params, :handler)

  def initialize
    @routes = []
    @not_found = method(:default_not_found)
    @error     = method(:default_error)
  end

  def get(path, &block)    = define('GET',    path, &block)
  def post(path, &block)   = define('POST',   path, &block)
  def put(path, &block)    = define('PUT',    path, &block)
  def patch(path, &block)  = define('PATCH',  path, &block)
  def delete(path, &block) = define('DELETE', path, &block)
  def head(path, &block)   = define('HEAD',   path, &block)

  def not_found(&block) = (@not_found = block)
  def error(&block)     = (@error     = block)

  def call(env)
    method = env['REQUEST_METHOD']
    path   = env['PATH_INFO'].chomp('/')
    path   = '/' if path.empty?

    @routes.each do |route|
      next unless route.method == method || (method == 'HEAD' && route.method == 'GET')

      if (match = route.pattern.match(path))
        params = match.named_captures
        env['router.params'] = params
        return route.handler.call(env, params)
      end
    end

    @not_found.call(env)
  rescue StandardError => e
    @error.call(env, e)
  end

  private

  def define(method, path, &handler)
    named_params = path.scan(/:(\w+)/).flatten
    pattern_str  = path.gsub(/:(\w+)/, '(?<\1>[^/]+)')
    pattern      = Regexp.new("\\A#{pattern_str}\\z")
    @routes << Route.new(method, pattern, named_params, handler)
  end

  def default_not_found(env)
    [404, {'Content-Type' => 'text/plain'}, ['Not Found']]
  end

  def default_error(env, exception)
    $stderr.puts "#{exception.class}: #{exception.message}"
    $stderr.puts exception.backtrace.first(10).join("\n")
    [500, {'Content-Type' => 'text/plain'}, ['Internal Server Error']]
  end
end
```

Use it as a Rack app:

```ruby
# config.ru
require_relative 'router'
require_relative 'handlers'  # wherever your handler code lives

router = Router.new

router.get('/') do |env, params|
  [200, {'Content-Type' => 'text/html'}, ['<h1>Home</h1>']]
end

router.get('/users/:id') do |env, params|
  user = User.find(params['id'].to_i)
  [200, {'Content-Type' => 'application/json'}, [user.to_json]]
end

router.not_found do |env|
  [404, {'Content-Type' => 'text/html'}, ['<h1>Page Not Found</h1>']]
end

run router
```

## What Frameworks Add on Top

Our router covers the basics. Here's what Rails's and Sinatra's routers add:

**Named routes and URL helpers**: `user_path(id: 42)` instead of `"/users/#{42}"`. This requires storing route patterns as templates, not just regexes.

**Nested resources**: `resources :users do; resources :posts; end` generates all CRUD routes for posts nested under users. Our router requires you to define each route manually.

**Route priorities and overrides**: When multiple routes could match, Rails has a precise priority order. Our router uses first-match-wins, which is simpler but less flexible.

**Format matching**: Rails can route `GET /users/42.json` differently from `GET /users/42`, based on the format suffix or `Accept` header.

**Redirect and inline responders**: `get '/old', redirect('/new')` in Sinatra.

**Route constraints with arbitrary code**: Rails lets you pass lambdas as constraints.

These are real features that real applications use. They're also each independently implementable on top of what we've built — the router isn't magical, it's just accreted features.

## The Insight

A router is a list of `(method, pattern, handler)` tuples. Matching is: iterate the list, test each pattern against the incoming path, run the first match. Everything else is optimization or ergonomics.

When you see a routing DSL — `resources :users`, `namespace :api`, `scope '/v2'` — it's generating these tuples. The DSL exists because writing tuples manually is tedious at scale. But it's still tuples.

If you ever need to debug a routing issue, you can inspect the generated routes. In Rails: `Rails.application.routes.routes` gives you the raw route list. In Sinatra: `MyApp.routes` shows all defined routes. You're looking at the tuples.

Next: making request and response handling a little less manual.
