# The Routing Tree (Roda's Big Idea)

Roda's routing tree is the thing that makes it different from every other Ruby web framework. Not just in performance, but in how you think about URL structure. Understanding it deeply makes you a more effective Roda developer and a more effective web developer in general.

## The Core Idea

In a flat router, all routes are evaluated independently:

```ruby
# Flat routing (Sinatra-style)
get '/projects'          → list handler
post '/projects'         → create handler
get '/projects/:id'      → show handler
put '/projects/:id'      → update handler
delete '/projects/:id'   → delete handler
```

Each route is matched from scratch against every incoming request.

In Roda's tree router, routes are nested. You consume the path incrementally:

```ruby
# Tree routing (Roda-style)
route do |r|
  r.on 'projects' do          # consumes "projects"
    r.is do                   # matches if nothing left
      r.get  { list }
      r.post { create }
    end

    r.on :id do               # consumes a segment, captures it
      project = Project[r.params['id']]

      r.is do                 # matches if nothing left
        r.get    { show(project) }
        r.put    { update(project) }
        r.delete { delete(project) }
      end

      r.on 'tasks' do         # consumes "tasks"
        # task routes here
      end
    end
  end
end
```

The path is consumed incrementally as you descend the tree. Once `r.on 'projects'` matches and the `projects` segment is consumed, the code inside that block only sees the remaining path. The `projects` prefix is checked once.

## How Roda Actually Works Internally

Roda's routing block is a plain Ruby block that is re-executed for every request. Each call to `r.on`, `r.is`, `r.get`, etc. checks the current remaining path against its argument. If the check passes, it consumes the matched portion and yields. If it fails, it returns without running the block.

```ruby
# Conceptually, r.on works like this:
def on(segment)
  if @remaining_path.start_with?("/#{segment}")
    old_path = @remaining_path
    @remaining_path = @remaining_path.sub("/#{segment}", '') || '/'
    result = yield  # run the block
    @remaining_path = old_path  # restore on backtrack
    result
  end
  # If not matched, just return nil
end
```

This "consume and restore" behavior is what makes the tree routing work correctly: if a branch doesn't match, the path is restored and the next branch can try.

The critical performance consequence: when `r.on 'projects'` doesn't match (because the path is `/users/42`), **none of the code inside that block runs at all.** The entire subtree of project-related routes is skipped in one comparison.

## A Working Example

Let's install Roda and build a concrete routing example:

```bash
gem install roda
```

```ruby
# routing_demo.rb
require 'roda'

class App < Roda
  route do |r|
    # Match /
    r.root do
      "Welcome to the routing demo"
    end

    # Match anything starting with /api
    r.on 'api' do
      # Match /api/v1/...
      r.on 'v1' do

        # Match /api/v1/users or /api/v1/users/...
        r.on 'users' do
          r.is do
            # Exactly /api/v1/users
            r.get  { "List users" }
            r.post { "Create user" }
          end

          r.on Integer do |id|
            # /api/v1/users/42 (Integer matcher converts to integer)
            user_info = "User ##{id}"

            r.is do
              r.get    { "Show #{user_info}" }
              r.put    { "Update #{user_info}" }
              r.delete { "Delete #{user_info}" }
            end

            r.on 'posts' do
              r.is do
                r.get  { "Posts for #{user_info}" }
                r.post { "Create post for #{user_info}" }
              end
            end
          end
        end

      end
    end
  end
end

# Run with: rackup -e 'run App'
# Or test with Rack::MockRequest:
require 'rack/mock'

def request(method, path)
  env = Rack::MockRequest.env_for(path, method: method)
  status, _, body = App.call(env)
  "#{status}: #{body.join}"
end

puts request('GET',    '/')
puts request('GET',    '/api/v1/users')
puts request('POST',   '/api/v1/users')
puts request('GET',    '/api/v1/users/42')
puts request('DELETE', '/api/v1/users/42')
puts request('GET',    '/api/v1/users/42/posts')
puts request('GET',    '/nonexistent')
```

Output:

```
200: Welcome to the routing demo
200: List users
200: Create user
200: Show User #42
200: Delete User #42
200: Posts for User #42
404:
```

## r.on, r.is, and r.get/post/etc.

These three methods do different things:

**`r.on(matcher)`** — partial match. Matches if the path starts with the segment, then yields with the segment consumed. Used for routing prefixes.

```ruby
r.on 'admin' do
  # runs for any path starting with /admin
  # remaining path is everything after /admin
end
```

**`r.is(matcher)`** — exact match. Matches if the matcher matches AND nothing is left in the path. Used for terminal routes.

```ruby
r.on 'users' do
  r.is do
    # runs only for exactly /users, not /users/anything
  end

  r.is :id do |id|
    # runs only for exactly /users/something, captures :id
  end
end
```

**`r.get`, `r.post`, etc.** — method match. These check the HTTP method. They imply `r.is` when used without arguments:

```ruby
r.get do
  # GET request, and nothing left in path
end

r.get 'status' do
  # GET /status (consumes "status", matches end of path)
end
```

When you write `r.get { "hello" }` inside an `r.on` block, you're saying: "If the HTTP method is GET AND there's nothing left in the path, run this block."

## Matchers

The argument to `r.on` and `r.is` is a "matcher." Roda has several built-in matchers:

**String** — matches a literal path segment:
```ruby
r.on 'users' do ... end       # matches /users/...
r.on 'api/v1' do ... end      # matches /api/v1/... (multi-segment)
```

**Symbol** — captures any non-empty path segment as a string:
```ruby
r.on :id do |id|
  # id is a String, e.g., "42" or "alice"
end
```

**Integer** — captures a numeric path segment, converts to Integer:
```ruby
r.on Integer do |id|
  # id is an Integer, e.g., 42
  # non-numeric segments don't match
end
```

**String with captures** — a regex-like pattern:
```ruby
r.on /\d{4}-\d{2}-\d{2}/ do |date|
  # matches a date like 2026-02-19
end
```

**Regexp** — matches against the remaining path:
```ruby
r.on /posts-(\d+)/ do |post_id|
  # captures the numeric part of "posts-42"
end
```

**`true`** — always matches (useful for catch-all routes):
```ruby
r.on true do
  "Catch-all handler"
end
```

**Multiple arguments** — all must match (AND logic):
```ruby
r.on 'projects', Integer do |id|
  # matches /projects/42, captures 42
end
```

## Branching and Fallthrough

The routing block returns normally (not via exception) when a route matches. If nothing matches, the block returns `nil`, and Roda returns a 404.

This means you can have fallthrough behavior:

```ruby
route do |r|
  r.on 'admin' do
    unless current_user&.admin?
      r.redirect '/login'
    end

    r.get 'dashboard' do
      "Admin dashboard"
    end
  end
end
```

If `current_user` isn't an admin, the redirect fires. If they are an admin, we proceed to the inner routes. The routing block is just Ruby — you can use conditionals, early returns, and any other control flow.

## Route Variables and Scope

Because the routing block runs inside the Roda application instance, all instance methods and variables are available:

```ruby
class App < Roda
  def current_user
    # ... look up user from session ...
  end

  def require_login!
    r.redirect '/login' unless current_user
  end

  route do |r|
    r.on 'account' do
      require_login!

      r.get 'profile' do
        "Profile for #{current_user.name}"
      end
    end
  end
end
```

`require_login!` is an instance method. `current_user` is an instance method. The routing block runs as an instance method (it's `instance_exec`'d), so it has access to both.

This is fundamentally different from Sinatra, where `before` blocks are separate from route handlers. In Roda, "before actions" are just code before the route match — you write them inline, as Ruby code.

## Why This Is Better Than a Flat Router

Consider loading a project from the database. In a flat router, you do it in each handler that needs it:

```ruby
# Flat router — repetitive
get '/projects/:id' do
  project = Project.find(params[:id])
  return 404 unless project
  project.to_json
end

put '/projects/:id' do
  project = Project.find(params[:id])
  return 404 unless project
  project.update(params[:data])
  project.to_json
end

delete '/projects/:id' do
  project = Project.find(params[:id])
  return 404 unless project
  project.destroy
  204
end
```

In Roda's tree router, you do it once:

```ruby
# Tree router — DRY
r.on 'projects', Integer do |id|
  project = Project[id]
  r.halt(404, 'Not found') unless project

  r.get  { project.to_json }
  r.put  { project.update(r.params[:data]); project.to_json }
  r.delete { project.destroy; r.response.status = 204; '' }
end
```

The database lookup happens once, at the point where the `:id` segment is consumed. All handlers beneath that point get the already-loaded `project`. If the project doesn't exist, `r.halt` stops routing and returns 404 immediately.

This is not just more concise — it's correct in a way the flat version isn't. In the flat version, you can accidentally forget to load the project in one handler. In the tree version, the project is available to all inner handlers by construction.

## The Insight

Here's the thing about tree routing that isn't obvious until you've worked with it: **your routing code is a direct representation of your URL structure.**

Look at the nested `r.on` calls in a Roda routing block, and you can read off the URL tree. Look at a flat list of Sinatra routes, and the URL structure is implicit — you have to mentally reconstruct it from the patterns.

When you need to add a new route under `/api/v1/users/:id`, you find the block that handles `Integer` inside the block that handles `users` inside the block that handles `v1` inside the block that handles `api`. You put your new route there. It automatically benefits from any setup code (loading the user from the database, checking permissions) that already runs at that point in the tree.

This is the correctness argument for tree routing. The performance argument is real but secondary. The main reason to use Roda's routing tree is that it makes the relationship between your URL structure and your code explicit and maintainable.

Next: let's build our first real Roda application.
