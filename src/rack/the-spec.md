# The Rack Spec (It Fits on a Napkin)

The Rack specification defines the interface between Ruby web servers and Ruby web applications. It was designed by Christian Neukirchen in 2007, and despite fifteen years of Ruby web development since then, it hasn't needed fundamental changes. Simple things tend to be durable.

Here's the spec:

> A Rack application is a Ruby object (not a class) that responds to `call`. It takes exactly one argument, the *environment*, and returns a non-frozen Array of exactly three values: the *status*, the *headers*, and the *body*.

That's it. Three rules:

1. Your app is an object (not a class — an instance)
2. It has a `call` method that takes an environment hash
3. `call` returns `[status, headers, body]`

Everything else is elaboration.

## The Environment Hash

The environment (called `env` by convention) is a Ruby Hash containing information about the current request. The server populates it. Your application reads from it.

The Rack spec requires these keys:

| Key | Type | Description |
|-----|------|-------------|
| `REQUEST_METHOD` | String | `"GET"`, `"POST"`, `"PUT"`, etc. |
| `SCRIPT_NAME` | String | Mount point of the application (often `""`) |
| `PATH_INFO` | String | Path component of the URL, e.g. `"/users/42"` |
| `QUERY_STRING` | String | Query string without `?`, e.g. `"page=2&sort=name"` |
| `SERVER_NAME` | String | Hostname, e.g. `"example.com"` |
| `SERVER_PORT` | String | Port as a string, e.g. `"80"` |
| `HTTP_*` | String | HTTP request headers, upcased with hyphens replaced by underscores |
| `rack.version` | Array | Rack version, e.g. `[1, 3]` |
| `rack.url_scheme` | String | `"http"` or `"https"` |
| `rack.input` | IO-like | The request body, readable via `read`, `gets`, `each` |
| `rack.errors` | IO-like | Error stream (usually `$stderr`) |
| `rack.multithread` | Boolean | Whether the server is multi-threaded |
| `rack.multiprocess` | Boolean | Whether the server is multi-process |
| `rack.run_once` | Boolean | Whether this process will handle only one request |
| `rack.hijack?` | Boolean | Whether the server supports connection hijacking |

In practice, you'll mostly use `REQUEST_METHOD`, `PATH_INFO`, `QUERY_STRING`, and `HTTP_*` headers. The `rack.input` stream is important for POST bodies.

Some real-world additions that aren't in the base spec but you'll encounter:

- `rack.session` — your session data (added by session middleware)
- `rack.logger` — a logger (added by logger middleware)
- `action_dispatch.*` — Rails-specific additions
- `HTTP_COOKIE` — cookies as a string (`"name=value; other=thing"`)

## The Response Array

The response is `[status, headers, body]`:

**Status**: An integer HTTP status code. `200`, `201`, `301`, `404`, `500`. That's it.

```ruby
status = 200
```

**Headers**: A Hash of response headers. Keys are strings. Values are strings.

```ruby
headers = {
  'Content-Type'  => 'text/html; charset=utf-8',
  'Content-Length' => '13',
}
```

**Body**: An object that responds to `each`, yielding string chunks. Usually an Array of strings, sometimes an IO object for streaming.

```ruby
body = ["Hello, World!"]

# Or for streaming:
body = SomeObject.new
def body.each
  yield "chunk 1"
  yield "chunk 2"
  yield "chunk 3"
end
```

The full minimal response:

```ruby
[200, {'Content-Type' => 'text/plain'}, ['Hello, World!']]
```

## The Simplest Possible Rack App

```ruby
# hello.rb
require 'rack'

app = lambda do |env|
  [200, {'Content-Type' => 'text/plain'}, ['Hello, World!']]
end

Rack::Handler::WEBrick.run app, Port: 9292
```

Run it:

```bash
$ gem install rack
$ ruby hello.rb
[2026-02-19 12:00:00] INFO  WEBrick 1.7.0
[2026-02-19 12:00:00] INFO  ruby 3.3.0
[2026-02-19 12:00:00] INFO  WEBrick::HTTPServer#start: pid=12345 port=9292
```

Then:

```bash
$ curl http://localhost:9292
Hello, World!
```

The lambda is a Rack application. It takes `env`, returns `[status, headers, body]`. The spec is satisfied.

## The config.ru Format

Most Ruby web servers look for a `config.ru` file in the current directory. It's processed by `Rack::Builder`, which gives you a small DSL:

```ruby
# config.ru

require_relative 'app'

use MyMiddleware           # add middleware to the stack
use AnotherMiddleware, option: 'value'

run MyApplication.new      # the innermost app
```

- `use` adds a middleware layer
- `run` sets the inner application
- `map` mounts apps at different paths (more on this later)

You can run any `config.ru` with:

```bash
$ rackup            # uses config.ru in current directory
$ rackup myapp.ru   # uses a specific file
```

`rackup` figures out the best available server and starts it.

## Reading the Environment

Here's a Rack app that echoes back what it received:

```ruby
# echo.ru
require 'json'

app = lambda do |env|
  # Collect interesting parts of the env
  info = {
    method:       env['REQUEST_METHOD'],
    path:         env['PATH_INFO'],
    query_string: env['QUERY_STRING'],
    headers:      env.select { |k, _| k.start_with?('HTTP_') },
  }

  # Read the body if there is one
  body = env['rack.input'].read
  info[:body] = body unless body.empty?

  response_body = JSON.pretty_generate(info)

  [
    200,
    {
      'Content-Type'   => 'application/json',
      'Content-Length' => response_body.bytesize.to_s,
    },
    [response_body]
  ]
end

run app
```

```bash
$ rackup echo.ru &
$ curl -X POST http://localhost:9292/test?foo=bar \
  -H 'Content-Type: application/json' \
  -d '{"hello": "world"}'
```

```json
{
  "method": "POST",
  "path": "/test",
  "query_string": "foo=bar",
  "headers": {
    "HTTP_HOST": "localhost:9292",
    "HTTP_USER_AGENT": "curl/7.88.1",
    "HTTP_ACCEPT": "*/*",
    "HTTP_CONTENT_TYPE": "application/json",
    "HTTP_CONTENT_LENGTH": "18"
  },
  "body": "{\"hello\": \"world\"}"
}
```

Notice that `Content-Type` in the request becomes `HTTP_CONTENT_TYPE` in the env. The transformation is: `HTTP_` prefix + uppercase + hyphens become underscores. The `Host` header becomes `HTTP_HOST`. `User-Agent` becomes `HTTP_USER_AGENT`.

There are two exceptions: `Content-Type` is available as both `HTTP_CONTENT_TYPE` and `CONTENT_TYPE` (without the `HTTP_` prefix), and `Content-Length` is `CONTENT_LENGTH`. This is for historical compatibility.

## Validation: Does Your App Comply?

`Rack::Lint` is a middleware that validates Rack compliance. Wrap your app with it during development:

```ruby
# config.ru (development)
require 'rack'

app = lambda do |env|
  [200, {'Content-Type' => 'text/plain'}, ['Hello']]
end

# Lint will raise on any spec violation
use Rack::Lint if ENV['RACK_ENV'] == 'development'
run app
```

`Rack::Lint` will raise an exception if:
- Your app doesn't return a three-element array
- The status isn't an integer
- Headers aren't a hash of strings
- The body doesn't respond to `each`
- The body elements aren't strings
- The env is missing required keys

It's useful when writing new middleware or apps. You won't see many Rack violations in production code because frameworks handle this — but when writing bare Rack code, `Rack::Lint` is your first line of defense.

## The Spec Is Deliberately Minimal

The Rack spec doesn't say anything about:
- How to parse query strings
- How to parse cookies
- How to handle sessions
- How to do routing
- How to render templates
- How to parse JSON or form bodies

These are all optional. You can build them yourself, use Rack's helpers, or use a framework. The spec only defines the handshake between server and application, not what the application does with the request.

This minimalism is intentional and correct. It means any Ruby object that can accept a hash and return a three-element array is a web application. It means a Rails app and a Sinatra app and a Roda app and a hand-rolled lambda all speak the same language at the boundary between server and application.

The result is an ecosystem where you can mix and match: Rails routes can mount Sinatra apps, Sinatra apps can mount Rack apps, everything can be wrapped in arbitrary middleware, and the server doesn't care what you're running as long as you respond to `call`.

## The Napkin Version

If you had to write the Rack spec on a napkin, it would say:

```
call(env) -> [status, headers, body]

env:    Hash of CGI-style variables + rack.* keys
status: Integer HTTP status code
headers: Hash of {String => String}
body:   Responds to each, yields strings
```

Everything else — sessions, routing, templates, auth — is above this abstraction. The abstraction itself is simple enough to hold in your head, which means you can reason about it clearly when things go wrong.

Next: let's use it.
