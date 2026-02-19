# Roll Your Own Mini-Framework (For Fun and Understanding)

Everything you've learned in this book is now in service of one exercise: building a small but complete web framework from scratch. Not a toy — a usable framework with routing, middleware support, a plugin system, and a test helper.

This is not an exercise in "why bother with frameworks?" Frameworks exist because this exercise, repeated at production scale, is what produces them. The point is to internalize the patterns by building them, so that you can read Roda's source, or Rails's source, or any Ruby web framework's source, and recognize what you're looking at.

## The Design

Our framework will be called `Kiwi`. It will have:

- Rack compatibility (obviously)
- A routing DSL with HTTP method helpers
- A simple plugin system
- A before/after filter mechanism
- A test helper
- About 150 lines of code

```ruby
# kiwi.rb
require 'rack'

module Kiwi
  class Application
    # Class-level state
    class << self
      def routes
        @routes ||= Hash.new { |h, k| h[k] = [] }
      end

      def filters
        @filters ||= {before: [], after: []}
      end

      def plugins
        @plugins ||= []
      end

      # HTTP method DSL
      def get(path, &handler)    = add_route('GET',    path, &handler)
      def post(path, &handler)   = add_route('POST',   path, &handler)
      def put(path, &handler)    = add_route('PUT',    path, &handler)
      def patch(path, &handler)  = add_route('PATCH',  path, &handler)
      def delete(path, &handler) = add_route('DELETE', path, &handler)

      def before(&block) = filters[:before] << block
      def after(&block)  = filters[:after]  << block

      def plugin(mod)
        extend mod::ClassMethods  if mod.const_defined?(:ClassMethods)
        include mod::InstanceMethods if mod.const_defined?(:InstanceMethods)
        mod.setup(self) if mod.respond_to?(:setup)
        plugins << mod
      end

      # Make the class itself a Rack app
      def call(env)
        new(env).dispatch
      end

      # Middleware support via Rack::Builder
      def use(middleware, *args, **kwargs, &block)
        @builder ||= Rack::Builder.new
        @builder.use(middleware, *args, **kwargs, &block)
        @builder.run(method(:dispatch_directly))
      end

      def to_app
        if @builder
          @builder.to_app
        else
          method(:dispatch_directly)
        end
      end

      private

      def dispatch_directly(env)
        new(env).dispatch
      end

      def add_route(method, path, &handler)
        pattern, param_names = compile_pattern(path)
        routes[method] << {pattern: pattern, params: param_names, handler: handler}
      end

      def compile_pattern(path)
        param_names = []
        pattern_str = path.gsub(/:(\w+)/) do
          param_names << $1
          '([^/]+)'
        end
        pattern = Regexp.new("\\A#{pattern_str}\\z")
        [pattern, param_names]
      end
    end

    # Instance methods (one instance per request)
    attr_reader :env, :request, :response, :params

    def initialize(env)
      @env      = env
      @request  = Rack::Request.new(env)
      @response = Rack::Response.new
      @params   = {}
    end

    def dispatch
      method = env['REQUEST_METHOD']
      path   = env['PATH_INFO']

      # Run before filters
      self.class.filters[:before].each { |f| instance_exec(&f) }

      result = find_and_run_route(method, path)

      # Run after filters
      self.class.filters[:after].each { |f| instance_exec(&f) }

      # Handle the result
      case result
      when Array  # raw Rack response
        result
      when String
        response.write(result)
        response.finish
      else
        response.status = 404
        response.write('Not Found')
        response.finish
      end
    rescue HaltError => e
      e.response
    end

    private

    def find_and_run_route(method, path)
      candidates = self.class.routes[method] || []

      candidates.each do |route|
        match = route[:pattern].match(path)
        next unless match

        # Populate params hash
        route[:params].each_with_index do |name, i|
          @params[name] = match[i + 1]
        end
        @params.merge!(request.params)

        return instance_exec(@params, &route[:handler])
      end

      nil  # no match → 404
    end
  end

  # Early exit mechanism
  class HaltError < StandardError
    attr_reader :response

    def initialize(status, body = '', headers = {})
      @response = [status, {'Content-Type' => 'text/plain'}.merge(headers), [body]]
    end
  end

  module InstanceMethods
    def halt(status, body = '', headers = {})
      raise HaltError.new(status, body, headers)
    end

    def redirect(location, status = 302)
      halt(status, '', 'Location' => location)
    end

    def json(data, status: 200)
      require 'json'
      body = JSON.generate(data)
      response.status = status
      response['Content-Type'] = 'application/json'
      response.write(body)
      response.finish
    end
  end

  Application.include(InstanceMethods)
end
```

That's the core. ~120 lines. Let's verify it works:

```ruby
# test_kiwi.rb
require_relative 'kiwi'
require 'rack/mock'
require 'json'

class BlogApp < Kiwi::Application
  POSTS = {}
  NEXT  = [1]

  before do
    response['X-Framework'] = 'Kiwi/0.1'
  end

  get '/' do |params|
    json({posts: POSTS.count, message: 'Welcome to KiwiBlog'})
  end

  get '/posts' do |params|
    json(POSTS.values)
  end

  post '/posts' do |params|
    id   = NEXT[0]
    NEXT[0] += 1
    post = {id: id, title: params['title'], body: params['body']}
    POSTS[id] = post
    json(post, status: 201)
  end

  get '/posts/:id' do |params|
    post = POSTS[params['id'].to_i]
    halt(404, 'Post not found') unless post
    json(post)
  end

  delete '/posts/:id' do |params|
    halt(404) unless POSTS.delete(params['id'].to_i)
    response.status = 204
    ''
  end
end

# Test it
def req(method, path, body: nil)
  env = Rack::MockRequest.env_for(path,
    method: method,
    input:  body ? StringIO.new(body) : StringIO.new,
    'CONTENT_TYPE' => 'application/json'
  )
  BlogApp.call(env)
end

status, headers, body = req('GET', '/')
puts "#{status}: #{body.join}"
# 200: {"posts":0,"message":"Welcome to KiwiBlog"}
puts headers['X-Framework']
# Kiwi/0.1

status, headers, body = req('POST', '/posts',
  body: '{"title":"Hello","body":"World"}'
)
puts "#{status}: #{body.join}"
# 201: {"id":1,"title":"Hello","body":"World"}

status, _, body = req('GET', '/posts/1')
puts "#{status}: #{body.join}"
# 200: {"id":1,"title":"Hello","body":"World"}

status, _, _ = req('DELETE', '/posts/1')
puts status
# 204

status, _, body = req('GET', '/posts/1')
puts "#{status}: #{body.join}"
# 404: Post not found
```

## Adding the Plugin System

```ruby
# Add to Kiwi::Application class methods:

def self.plugin(mod)
  mod.extend(mod::ClassMethods) if mod.const_defined?(:ClassMethods)
  mod.setup(self) if mod.respond_to?(:setup)

  include mod::InstanceMethods if mod.const_defined?(:InstanceMethods)
end

# A plugin: JSON request body parsing
module Kiwi
  module JsonBody
    def self.setup(app)
      # no class-level setup needed
    end

    module InstanceMethods
      def json_body
        return {} unless env['CONTENT_TYPE']&.include?('application/json')
        require 'json'
        @json_body ||= JSON.parse(request.body.read)
      rescue JSON::ParserError
        halt(400, 'Invalid JSON')
      end
    end
  end

  # A plugin: simple authentication
  module SimpleAuth
    def self.setup(app)
      app.before do
        @authenticated = session_valid?
      end
    end

    module InstanceMethods
      def authenticated?
        @authenticated
      end

      def require_auth!
        halt(401, 'Unauthorized') unless authenticated?
      end

      private

      def session_valid?
        # In real life: check a session cookie or Authorization header
        env['HTTP_AUTHORIZATION'] == 'Bearer valid-token'
      end
    end
  end
end

# Using plugins:
class SecureApp < Kiwi::Application
  plugin Kiwi::JsonBody
  plugin Kiwi::SimpleAuth

  get '/public' do |_|
    'Anyone can see this'
  end

  get '/private' do |_|
    require_auth!
    json({secret: 'classified data'})
  end

  post '/data' do |_|
    require_auth!
    data = json_body
    json({received: data}, status: 201)
  end
end
```

## Adding a Test Helper

```ruby
# kiwi/test_helper.rb
module Kiwi
  module TestHelper
    def self.included(base)
      base.include(InstanceMethods)
    end

    module InstanceMethods
      def app_class
        raise NotImplementedError, "Define app_class in your test"
      end

      def get(path, headers: {})
        call_app('GET', path, headers: headers)
      end

      def post(path, body: nil, headers: {})
        call_app('POST', path, body: body, headers: headers)
      end

      def put(path, body: nil, headers: {})
        call_app('PUT', path, body: body, headers: headers)
      end

      def delete(path, headers: {})
        call_app('DELETE', path, headers: headers)
      end

      def post_json(path, data)
        post(path,
          body: JSON.generate(data),
          headers: {'CONTENT_TYPE' => 'application/json'}
        )
      end

      def last_status  = @last_response[0]
      def last_headers = @last_response[1]
      def last_body    = @last_response[2].join
      def last_json    = JSON.parse(last_body)

      private

      def call_app(method, path, body: nil, headers: {})
        env = Rack::MockRequest.env_for(path,
          {method: method, input: body ? StringIO.new(body) : StringIO.new}
            .merge(headers)
        )
        @last_response = app_class.call(env)
      end
    end
  end
end

# Using it:
require 'minitest/autorun'
require_relative 'kiwi/test_helper'
require_relative 'blog_app'

class BlogAppTest < Minitest::Test
  include Kiwi::TestHelper

  def app_class = BlogApp
  def setup    = BlogApp::POSTS.clear

  def test_home
    get '/'
    assert_equal 200, last_status
    assert_equal 0, last_json['posts']
  end

  def test_create_and_read_post
    post_json '/posts', title: 'Test', body: 'Content'
    assert_equal 201, last_status
    id = last_json['id']

    get "/posts/#{id}"
    assert_equal 200, last_status
    assert_equal 'Test', last_json['title']
  end
end
```

## What 150 Lines Taught Us

Our mini-framework implements:
- ✅ Rack compliance
- ✅ HTTP method routing (GET, POST, PUT, PATCH, DELETE)
- ✅ Path parameter extraction
- ✅ Query parameter merging
- ✅ Before/after filters
- ✅ JSON helpers
- ✅ Early exit via `halt`
- ✅ Redirect helper
- ✅ Plugin system
- ✅ Test helper

What it doesn't have:
- ❌ Tree routing (all routes are flat, O(n) matching)
- ❌ Route priorities
- ❌ Template rendering
- ❌ Sessions
- ❌ CSRF protection
- ❌ Asset handling
- ❌ WebSocket support
- ❌ Streaming responses
- ❌ Content negotiation
- ❌ A decade of bug fixes

The gap between our 150 lines and Roda's ~3,000 lines (core only) is exactly those missing features, plus the handling of edge cases we haven't considered (unusual HTTP methods, malformed requests, encoding issues, thread safety).

The gap between Roda and Rails is the additional 60,000+ lines that provide ActiveRecord, ActionView, ActionMailer, and the rest.

None of those additional lines are magic. They're solutions to real problems, written by people who understood exactly the same foundation we just built.

## Where to Go From Here

If you want to keep exploring:

- Read [Roda's source](https://github.com/jeremyevans/roda) — it's well-organized and the plugins are independently readable
- Read [Rack's source](https://github.com/rack/rack) — the middleware in the gem are good examples of the pattern
- Read [Sinatra's source](https://github.com/sinatra/sinatra/blob/main/lib/sinatra/base.rb) — it's a single large file and instructive in how a flat DSL framework is built
- Look at [Cuba](https://github.com/soveran/cuba) — a micro-framework even simpler than Kiwi that influenced Roda

The pattern you've built is the pattern everything uses. The rest is features.
