# The Lie You've Been Living

Let's start with a confession: Rails is a callable.

Not metaphorically. Not "if you squint at it." Literally, mechanically, by definition — Rails is an object that responds to `call`. You pass it a hash, it returns an array. That's the whole thing. The routing DSL, the ActiveRecord integration, the asset pipeline, the mailers — all of it exists so that one `call` method can do something useful.

Here's the proof:

```ruby
# config/environment.rb loads your Rails app
require_relative '../config/environment'

# This is your entire Rails application
app = Rails.application

# It responds to call
app.respond_to?(:call) # => true

# Call it directly with a minimal Rack environment
env = {
  'REQUEST_METHOD' => 'GET',
  'PATH_INFO'      => '/',
  'rack.input'     => StringIO.new,
  'SERVER_NAME'    => 'localhost',
  'SERVER_PORT'    => '3000',
  'HTTP_VERSION'   => 'HTTP/1.1',
}

status, headers, body = app.call(env)

puts status   # 200
puts headers  # {"Content-Type" => "text/html; charset=utf-8", ...}
body.each { |chunk| print chunk } # your HTML
```

Run that in a Rails console. It works. No HTTP required, no browser, no WEBrick. Just a hash in and an array out.

This is not a party trick. This is the entire basis of Ruby web development, and understanding it changes how you read framework code, debug middleware issues, and make architectural decisions.

## Why This Matters

You've probably been writing Ruby web applications for a while. You know how to define routes, render templates, write controllers, handle authentication. You're productive. The framework handles the HTTP layer and you work at the application layer, which is exactly the correct division of labor in production.

The problem is that "the framework handles it" is a sentence that stops you from understanding what's actually happening. When something breaks in a way that the framework's error messages don't explain clearly, you're stuck. When you need to write middleware, you're cargo-culting examples. When you're evaluating whether to use Sinatra or Roda or some other non-Rails framework, you're guessing.

The Rack specification — which is what makes all of this work — is simple enough to explain completely in one chapter. The HTTP protocol that sits beneath it is simple enough to understand in an afternoon. Once you understand both, the entire ecosystem of Ruby web frameworks becomes readable rather than mysterious.

## What This Book Is

This book is about three things:

1. **Rack**: The protocol that unifies Ruby web development. We'll read the spec, build apps against it directly, write our own server, and implement middleware from scratch.

2. **Roda**: A web framework that takes Rack seriously. Where Rails uses Rack as a compatibility layer (something your application sits on top of), Roda uses Rack as a foundation (something your application is built out of). The distinction matters.

3. **The gap between them**: What frameworks actually add, why those additions exist, and when you want them versus when you don't.

## What This Book Is Not

This is not a Rails tutorial, a Sinatra tutorial, or a Roda tutorial in the conventional sense. There are plenty of those. This is a book about the layer beneath those frameworks, with enough framework coverage to make the comparison meaningful.

This is also not a "write everything from scratch" manifesto. Frameworks exist because they solve real problems, and Roda is genuinely excellent at what it does. The goal isn't to convince you to abandon your tools; it's to make you fluent enough in the underlying mechanics that you can use your tools with full understanding of what they're doing.

## Prerequisites

You should know Ruby reasonably well — blocks, modules, objects, the basics of metaprogramming. You should have written at least one web application in Ruby, probably with Rails or Sinatra. You should be comfortable at the command line.

You do not need to know anything about Rack, Roda, or HTTP internals. We'll cover all of that.

## A Note on the Code

Every code example in this book runs. If an example requires a gem, it says so. If it requires Ruby 3.x, it says so. The examples are not simplified pseudocode — they're actual Ruby that does actual things.

The simplest Rack application in this book is nine lines. The server we build from scratch is about a hundred. Neither of these is a toy, even though neither is production-ready. They're instructive, which is more useful.

## Acknowledgements

Thanks to **Georgiy Treyvus** for coming up with the idea for this book.

Let's start by talking about what's actually happening on the wire.
