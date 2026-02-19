# Roda's Plugin System (Opt-In Everything)

Roda ships with a small core and a substantial library of optional plugins. The core gives you routing. Plugins give you everything else. This is not a compromise — it's a design philosophy with real consequences for performance, readability, and maintenance.

## Why Plugins Instead of Defaults

Most frameworks come with everything on. Rails loads session handling, CSRF protection, cookie parsing, flash messages, and two dozen other features before your first line of code runs. This is convenient when you need all of those things. It's wasteful when you don't.

Roda's approach: the core does almost nothing beyond routing. Every other feature is a plugin you explicitly enable. If you don't use sessions, you don't pay for session handling. If you don't use templates, there's no template engine in memory. If you build a pure JSON API, there's no HTML-related code in your stack.

The practical consequence is a dramatically smaller memory footprint and faster boot time for applications that don't need the kitchen sink. Roda applications are consistently among the fastest Ruby web frameworks in benchmarks, and the plugin system is a significant reason why.

## Loading Plugins

```ruby
class App < Roda
  plugin :json             # JSON serialization of return values
  plugin :json_parser      # Parse JSON request bodies
  plugin :halt             # r.halt for early exit
  plugin :all_verbs        # PUT, PATCH, DELETE support
  plugin :status_handler   # Custom handlers for 404, 500, etc.
  plugin :sessions,        # Cookie-based sessions
    secret: ENV['SESSION_SECRET']
end
```

`plugin` is a class method that extends the application class with the plugin's capabilities. Some plugins add instance methods. Some add class-level DSL. Some modify the request or response objects.

## The Core Plugins

Here's what the most commonly used plugins provide:

### json and json_parser

```ruby
plugin :json
plugin :json_parser

route do |r|
  r.post 'users' do
    # r.params already has the parsed JSON body (via json_parser)
    name = r.params['name']

    user = create_user(name)

    # Returning a Hash or Array automatically serializes to JSON (via json)
    user
  end
end
```

Without `json`, you'd write `response['Content-Type'] = 'application/json'; JSON.generate(user)` every time.

Without `json_parser`, you'd write `JSON.parse(env['rack.input'].read)` for every POST.

### halt

```ruby
plugin :halt

route do |r|
  r.on 'users', Integer do |id|
    user = User[id]
    r.halt(404, {'error' => 'user not found'}) unless user

    # user is definitely non-nil from here
    r.get { user }
  end
end
```

`r.halt` raises a special exception caught by Roda that immediately returns the given response. It's a clean way to implement guard clauses in routing code.

### status_handler

```ruby
plugin :status_handler

status_handler(404) do
  {'error' => 'Not found', 'path' => request.path}
end

status_handler(500) do |e|
  logger.error "#{e.class}: #{e.message}"
  {'error' => 'Internal server error'}
end
```

`status_handler` registers a block that runs when Roda would otherwise return that status code — including when `r.halt(404)` is called and when an unhandled exception occurs.

### sessions

```ruby
plugin :sessions, secret: ENV.fetch('SESSION_SECRET')

route do |r|
  r.post 'login' do
    user = User.authenticate(r.params['username'], r.params['password'])

    if user
      session['user_id'] = user.id
      {'status' => 'logged in'}
    else
      r.halt(401, {'error' => 'invalid credentials'})
    end
  end

  r.get 'me' do
    user_id = session['user_id']
    r.halt(401, {'error' => 'not authenticated'}) unless user_id
    User[user_id]
  end
end
```

Sessions are signed cookies by default. The `secret` is used to generate the HMAC signature that prevents tampering.

### render (Tilt/ERB templates)

```ruby
plugin :render, views: 'views'

route do |r|
  r.get 'users' do
    @users = User.all
    render('users/index')  # renders views/users/index.erb
  end

  r.get 'users', Integer do |id|
    @user = User[id]
    r.halt(404) unless @user
    render('users/show')
  end
end
```

The `render` plugin uses Tilt under the hood, which supports ERB, Haml, Slim, and other template engines. Instance variables set in the routing block are available in templates.

### csrf

```ruby
plugin :csrf

route do |r|
  # CSRF token is automatically checked on POST/PUT/PATCH/DELETE
  # You need to include the token in your forms:
  # <input type="hidden" name="_csrf" value="<%= csrf_token %>">
end
```

CSRF protection verifies that state-changing requests include a valid token. The `csrf` plugin adds this check automatically for non-GET requests, with a configurable token field name.

### assets

```ruby
plugin :assets,
  css: ['app.css'],
  js:  ['app.js']

route do |r|
  r.assets  # serves /assets/... in development
  # ...
end
```

The `assets` plugin handles serving static assets in development and generating fingerprinted asset paths for production.

### websockets

```ruby
plugin :websockets

route do |r|
  r.get 'ws' do
    r.websocket do |ws|
      ws.on(:message) { |msg| ws.send("echo: #{msg}") }
      ws.on(:close)   { puts "disconnected" }
    end
  end
end
```

WebSocket support as a plugin. If you don't use WebSockets, none of this code is loaded.

## Writing Your Own Plugin

A Roda plugin is a Ruby module. The structure:

```ruby
module Roda::RodaPlugins::MyPlugin
  # Code that runs when plugin is loaded
  def self.configure(app, opts = {})
    app.instance_variable_set(:@my_plugin_opts, opts)
  end

  # Methods added to the application class itself
  module ClassMethods
    def my_class_method
      "available as App.my_class_method"
    end
  end

  # Methods added to the application instance
  # (available in the route block and route methods)
  module InstanceMethods
    def current_user
      @current_user ||= User[session['user_id']]
    end

    def require_login!
      r.halt(401, {'error' => 'not authenticated'}) unless current_user
    end
  end

  # Methods added to r (the request object)
  module RequestMethods
    def require_permission!(permission)
      user = scope.current_user  # scope = the app instance
      unless user&.has_permission?(permission)
        halt(403, {'error' => 'forbidden'})
      end
    end
  end

  # Methods added to the response object
  module ResponseMethods
    def set_flash(message)
      self['X-Flash-Message'] = message
    end
  end
end

# Register the plugin so `plugin :my_plugin` finds it
Roda::RodaPlugins.register_plugin(:my_plugin, Roda::RodaPlugins::MyPlugin)
```

Use it:

```ruby
class App < Roda
  plugin :my_plugin, some_option: 'value'

  route do |r|
    r.on 'protected' do
      require_login!           # from InstanceMethods
      r.require_permission!(:admin)  # from RequestMethods

      r.get { current_user }  # from InstanceMethods
    end
  end
end
```

This is not magic. `module ClassMethods` is extended into the application class. `module InstanceMethods` is included into the application class (so its methods become instance methods). `module RequestMethods` is included into `Roda::RodaRequest`. `module ResponseMethods` is included into `Roda::RodaResponse`.

## Composing Plugins

One plugin can use another:

```ruby
module Roda::RodaPlugins::RequiresJson
  def self.load_dependencies(app)
    app.plugin :json
    app.plugin :json_parser
    app.plugin :halt
  end

  module InstanceMethods
    def json_only!
      unless request.content_type&.include?('application/json')
        r.halt(415, {'error' => 'application/json required'})
      end
    end
  end
end
```

`load_dependencies` is called before `configure`, and loads other plugins that this plugin depends on. The dependent plugins are loaded once, even if multiple plugins list the same dependency.

## The Plugin System Is Rack's Philosophy Applied Again

Rack's philosophy: define a small interface, let everything else be composed on top.

Roda's plugin philosophy: define a small core, let everything else be opted into explicitly.

Both philosophies produce systems that are:
- **Comprehensible**: you can see exactly what's in your application
- **Measurable**: you can benchmark only what you've loaded
- **Debuggable**: when something goes wrong, you know what's running

When a Rails application behaves unexpectedly, "some middleware somewhere is doing something" is often the explanation. When a Roda application behaves unexpectedly, you look at the plugins you loaded. The list is short and you wrote it.

The tradeoff is explicit configuration. You have to know which plugins to load. You can't rely on convention as a substitute for understanding. This is not a bug — it's the point.

## What the Full Stack Looks Like

A production Roda application using many features:

```ruby
class App < Roda
  # Core functionality
  plugin :json
  plugin :json_parser
  plugin :halt
  plugin :all_verbs

  # Request/response helpers
  plugin :status_handler
  plugin :request_headers

  # Security
  plugin :sessions, secret: ENV.fetch('SESSION_SECRET')
  plugin :csrf

  # Content
  plugin :render, views: 'views', layout: 'layout'
  plugin :assets, css: %w[app.css], js: %w[app.js]

  # Performance
  plugin :caching       # ETag/Last-Modified support
  plugin :content_for   # Yield blocks into layouts

  # Error handling
  plugin :error_handler do |e|
    logger.error "#{e.class}: #{e.message}\n#{e.backtrace.first(10).join("\n")}"
    r.halt(500, {'error' => 'Internal server error'})
  end

  status_handler(404) { render('errors/404') }
  status_handler(403) { render('errors/403') }

  route do |r|
    r.assets

    r.on 'api' do
      # API routes — JSON responses
      r.on 'users' do
        # ...
      end
    end

    # Web routes — HTML responses
    r.get 'dashboard' do
      require_login!
      @data = load_dashboard_data
      render('dashboard')
    end
  end
end
```

This application has explicit sessions, CSRF protection, error handling, template rendering, and asset serving. Nothing is hidden. Every feature is a named plugin.

Next: how middleware fits into a Roda application.
