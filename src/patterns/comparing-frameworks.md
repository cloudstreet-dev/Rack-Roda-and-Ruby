# Rails vs Sinatra vs Roda (Now That You Know What They Are)

Having built a Rack server, written middleware, implemented a router, and assembled a mini-framework, we're in a position to compare these three frameworks with precision rather than opinion.

This is not a benchmark article. Benchmarks are useful but narrow. This is a comparison of design philosophies, and what those philosophies mean for the kind of applications each framework is appropriate for.

## The Common Foundation

All three frameworks:
- Are valid Rack applications — they respond to `call(env)` and return `[status, headers, body]`
- Can use any Rack-compatible server (Puma, Unicorn, Falcon, WEBrick)
- Can use any Rack middleware
- Can be mounted inside each other

Here's the proof of the last point:

```ruby
# A Rails app mounting a Sinatra app mounting a Roda app
# This is contrived, but it works.

# roda_api.rb
class RodaApi < Roda
  plugin :json
  route do |r|
    r.get 'status' do
      {'roda' => true}
    end
  end
end

# sinatra_app.rb
require 'sinatra/base'
class SinatraApp < Sinatra::Base
  get '/sinatra/status' do
    content_type :json
    {sinatra: true}.to_json
  end

  # Mount the Roda app
  map('/roda') { run RodaApi }
end

# In config/routes.rb (Rails)
Rails.application.routes.draw do
  mount SinatraApp => '/sinatra-land'
  # GET /sinatra-land/sinatra/status → Sinatra handles it
  # GET /sinatra-land/roda/status   → Roda handles it
end
```

This works because they all speak Rack. `mount` in Rails routes calls the mounted app's `call` method for matching requests.

## Rails

**What it is:** A full-stack web framework with conventions for everything. Database ORM (ActiveRecord), view rendering (ActionView), email (ActionMailer), jobs (ActiveJob), WebSockets (ActionCable), asset compilation, and more — all integrated and conventionally configured.

**What it gives you:**
- `rails generate` scaffolds entire CRUD resources in seconds
- ActiveRecord is a mature, powerful ORM with a large ecosystem of gems
- Rails's conventions mean you can pick up a Rails project and know where things live
- ActiveSupport adds useful Ruby core extensions
- Security features (CSRF, XSS protection) on by default
- The largest Ruby web framework community, by far

**What it costs:**
- Memory: a minimal Rails app uses ~70-100MB of RAM at startup, before your code runs
- Boot time: several seconds in development, longer in large applications
- Complexity: the middleware stack, before/after callback chains, and concerns can make tracing execution surprisingly difficult
- Convention lock-in: stepping outside Rails conventions (different ORMs, custom routing) requires fighting the framework

**When to choose Rails:**
- You're building an application that fits the Rails sweet spot: database-backed web application with HTML views, standard CRUD operations, authenticated users
- You value the breadth of the ecosystem (authentication gems like Devise, admin interfaces like ActiveAdmin, pagination, etc.)
- Your team already knows Rails
- You need to move fast and the application is relatively conventional

**When Rails is the wrong choice:**
- Pure JSON APIs where ActiveRecord's overhead isn't needed
- Applications with unusual routing requirements (Rails's router is powerful but the flat route list doesn't scale as well as a tree)
- High-traffic applications where memory and boot time matter significantly
- Microservices where you want minimal dependencies

```ruby
# Rails: conventions do a lot of work
class ProjectsController < ApplicationController
  before_action :authenticate!
  before_action :set_project, only: [:show, :update, :destroy]

  def index
    @projects = current_user.projects
    render json: @projects
  end

  def show
    render json: @project
  end

  def create
    @project = current_user.projects.build(project_params)
    if @project.save
      render json: @project, status: :created
    else
      render json: @project.errors, status: :unprocessable_entity
    end
  end

  private

  def set_project
    @project = current_user.projects.find(params[:id])
  end

  def project_params
    params.require(:project).permit(:name, :description)
  end
end
```

## Sinatra

**What it is:** A minimal web DSL. Routes, filters, helpers, template rendering. Nothing else.

**What it gives you:**
- Simple, readable routing DSL
- Template rendering via Tilt (ERB, Haml, Slim, Markdown, etc.)
- Before/after filters
- Helper methods via `helpers do`
- Very fast startup time

**What it costs:**
- Flat route list (same performance concerns as our hand-rolled router for large apps)
- No built-in solution for many common concerns (sessions via Rack middleware, auth you write yourself)
- Routing doesn't compose well — there's no natural way to express hierarchical routes
- The DSL can mislead you: Sinatra looks simple but some things (understanding scope in blocks, class vs. instance methods) are surprising

**When to choose Sinatra:**
- Small APIs with a modest number of routes
- Webhook receivers
- Development tools and internal utilities
- Prototypes
- Applications where you want to understand exactly what's in your stack

**When Sinatra is the wrong choice:**
- Large applications with complex routing (the flat route list becomes a maintenance burden)
- Applications that need the performance of tree routing
- Any application where you'd reinvent what Roda provides

```ruby
# Sinatra: explicit and readable, but flat
class App < Sinatra::Base
  before do
    halt 401 unless authenticated?
  end

  get '/projects' do
    content_type :json
    Project.all.to_json
  end

  get '/projects/:id' do
    project = Project.find_by(id: params[:id])
    halt 404 unless project
    content_type :json
    project.to_json
  end

  post '/projects' do
    project = Project.create(params[:project])
    content_type :json
    status 201
    project.to_json
  end
end
```

## Roda

**What it is:** A Rack framework built around a routing tree and an opt-in plugin system.

**What it gives you:**
- Tree routing that scales to large applications
- Plugin system that keeps your footprint small
- Correct routing semantics (shared setup for nested routes)
- Fast — consistently one of the fastest Ruby web frameworks
- Excellent test ergonomics
- A codebase small enough to read and understand fully

**What it costs:**
- Smaller ecosystem than Rails (fewer ready-made gems designed for Roda)
- No ORM included (you choose Sequel, ActiveRecord, or ROM)
- More explicit configuration (everything is opt-in, nothing is automatic)
- Less documentation and fewer tutorials than Rails

**When to choose Roda:**
- JSON APIs, especially those with complex routing
- Applications where memory and performance are important
- Teams that value explicit over implicit
- Applications using Sequel (Jeremy Evans authored both)
- When you want a framework whose internals you can actually understand

**When Roda is the wrong choice:**
- When you need the Rails ecosystem (Devise, RailsAdmin, etc.) specifically
- Teams that are deeply invested in Rails conventions and don't want to change

```ruby
# Roda: hierarchical, DRY, explicit
class App < Roda
  plugin :json
  plugin :json_parser
  plugin :halt
  plugin :all_verbs

  route do |r|
    authenticate!

    r.on 'projects' do
      r.is do
        r.get  { Project.all }
        r.post do
          project = Project.create(r.params['project'])
          response.status = 201
          project
        end
      end

      r.on Integer do |id|
        project = Project[id]
        r.halt(404, {'error' => 'not found'}) unless project

        # All three handlers share the already-loaded project
        r.get    { project }
        r.put    { project.update(r.params['project']); project }
        r.delete { project.destroy; response.status = 204; '' }
      end
    end
  end
end
```

## The Actual Decision Criteria

When choosing a framework, the questions that matter:

**1. What is the team's existing knowledge?**
A team that knows Rails deeply will be more productive with Rails than with Roda, even if Roda is theoretically a better fit. Retraining time is a real cost.

**2. What does the application actually need?**
If you need ActiveRecord's specific feature set (STI, counter caches, extensive callbacks), Rails's integration with it is valuable. If you're choosing your ORM separately (Sequel, ROM), Roda or Sinatra might be cleaner.

**3. What are the performance requirements?**
A small API that gets 100 requests per second doesn't need Roda's performance advantages. An API getting 10,000 requests per second might care very much.

**4. How complex is the routing?**
10 routes: all three work fine. 50 routes: Rails and Roda both handle it; Sinatra starts to get unwieldy. 200 routes: Roda's tree routing is a genuine advantage.

**5. How much do you value explicitness?**
Rails convention is powerful when you know what the conventions are and your application follows them. When you step outside them, it's friction. Roda's opt-in approach means you always know what's running.

## What They Actually Share

This is the more important point: **all three frameworks are doing the same fundamental thing.** They receive a Rack env hash, they route the request to a handler, the handler returns a response, the response is sent.

The differences are:
- How routing is expressed and evaluated
- What defaults are provided
- What the plugin/gem ecosystem looks like
- Memory and performance characteristics

None of these differences are about what's possible. Everything you can build with Rails, you can build with Roda or Sinatra. The differences are about convenience, convention, and performance.

When you know Rack, you know that Rails isn't doing magic — it's routing to a callable and returning a response array. When you know routing is pattern matching, you can read any framework's routing code. When you know middleware is just objects wrapping other objects, you can debug middleware issues in any framework.

The framework you choose matters less than you probably thought before reading this book. Your understanding of what it's doing matters considerably more.

## A Note on Performance Numbers

Roda is consistently faster than Sinatra and dramatically faster than Rails in benchmarks. Some rough ordering for a "hello world" endpoint:

| Framework | Throughput (relative) | Memory |
|-----------|----------------------|--------|
| Roda      | ~100%                | ~30MB  |
| Sinatra   | ~60-70%              | ~40MB  |
| Rails     | ~20-30%              | ~100MB |

These numbers are meaningless without context. A "hello world" benchmark measures framework overhead, not application overhead. In a real application:
- Your business logic usually dominates the response time
- Database queries are usually the bottleneck, not routing
- Memory differences matter at scale (100 processes × 70MB difference = 7GB)

The performance advantage of Roda matters when you're CPU-bound on framework overhead, which happens at high traffic volume or in very thin services. For most applications, pick the framework your team knows best and optimize later if needed.

The understanding advantage — knowing what your framework is doing — matters always.
