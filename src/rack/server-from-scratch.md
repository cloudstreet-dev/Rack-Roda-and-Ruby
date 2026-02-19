# Build a Rack Server from Scratch

A Rack server has one job: accept HTTP connections, parse them into a Rack env hash, call your application, and serialize the response back into HTTP. Let's build one.

This isn't a production server. It handles one request at a time, ignores keep-alive, has no TLS, and will fall over under load. It is, however, a real HTTP server that speaks valid HTTP/1.1 and can run actual Rack applications. Understanding it will demystify everything that happens before your application code runs.

## The Structure

A Rack server needs to:

1. Listen on a TCP port
2. Accept connections in a loop
3. Parse the HTTP request into a Rack env hash
4. Call the application with the env
5. Serialize the `[status, headers, body]` response into HTTP
6. Write it to the socket

Let's build each piece.

## Step 1: The TCP Listener

```ruby
require 'socket'

server = TCPServer.new('0.0.0.0', 9292)
puts "Listening on http://localhost:9292"

loop do
  client = server.accept
  # handle client
  client.close
end
```

`TCPServer.new` opens a socket. `server.accept` blocks until a connection arrives, then returns a `TCPSocket` representing that connection. Straightforward.

## Step 2: Parsing the HTTP Request

HTTP requests look like this:

```
GET /path?query=string HTTP/1.1\r\n
Host: localhost:9292\r\n
Accept: text/html\r\n
\r\n
```

We need to parse this into a Rack env hash. The tricky parts are:
- Headers end at a blank line (`\r\n` alone)
- The body follows the blank line, if `Content-Length` is set
- Header names become `HTTP_UPPERCASED_WITH_UNDERSCORES`

```ruby
def parse_request(client)
  # Read the request line
  request_line = client.gets&.chomp
  return nil unless request_line

  method, full_path, http_version = request_line.split(' ', 3)
  path, query_string = full_path.split('?', 2)

  # Read headers until blank line
  headers = {}
  while (line = client.gets&.chomp) && !line.empty?
    name, value = line.split(': ', 2)
    headers[name] = value
  end

  # Read body if Content-Length is present
  body = ''
  if (length = headers['Content-Length']&.to_i) && length > 0
    body = client.read(length)
  end

  # Build the Rack env
  env = {
    # Required CGI variables
    'REQUEST_METHOD'    => method,
    'SCRIPT_NAME'       => '',
    'PATH_INFO'         => path,
    'QUERY_STRING'      => query_string || '',
    'SERVER_NAME'       => 'localhost',
    'SERVER_PORT'       => '9292',
    'HTTP_VERSION'      => http_version,
    'SERVER_PROTOCOL'   => http_version,

    # Rack-specific
    'rack.version'      => [1, 3],
    'rack.input'        => StringIO.new(body),
    'rack.errors'       => $stderr,
    'rack.multithread'  => false,
    'rack.multiprocess' => false,
    'rack.run_once'     => false,
    'rack.url_scheme'   => 'http',
  }

  # Convert HTTP headers to CGI format
  headers.each do |name, value|
    # Content-Type and Content-Length get special treatment
    key = case name
          when 'Content-Type'   then 'CONTENT_TYPE'
          when 'Content-Length' then 'CONTENT_LENGTH'
          else "HTTP_#{name.upcase.gsub('-', '_')}"
          end
    env[key] = value
  end

  env
end
```

The header name transformation — `Content-Type` becomes `HTTP_CONTENT_TYPE`, `X-Request-Id` becomes `HTTP_X_REQUEST_ID` — is a CGI convention that Rack inherits. It's annoying but consistent.

## Step 3: Serializing the Response

The response is `[status, headers, body]`. We need to turn that into HTTP/1.1 text:

```ruby
STATUS_PHRASES = {
  200 => 'OK',
  201 => 'Created',
  204 => 'No Content',
  301 => 'Moved Permanently',
  302 => 'Found',
  304 => 'Not Modified',
  400 => 'Bad Request',
  401 => 'Unauthorized',
  403 => 'Forbidden',
  404 => 'Not Found',
  405 => 'Method Not Allowed',
  415 => 'Unsupported Media Type',
  422 => 'Unprocessable Entity',
  500 => 'Internal Server Error',
}.freeze

def send_response(client, status, headers, body)
  phrase = STATUS_PHRASES[status] || 'Unknown'

  # Status line
  client.write("HTTP/1.1 #{status} #{phrase}\r\n")

  # Headers
  headers.each do |name, value|
    client.write("#{name}: #{value}\r\n")
  end

  # Blank line separating headers from body
  client.write("\r\n")

  # Body — iterate over whatever the app gave us
  body.each do |chunk|
    client.write(chunk)
  end

  # Some body objects need to be closed (file handles, etc.)
  body.close if body.respond_to?(:close)
end
```

## Putting It Together

```ruby
# tiny_server.rb
require 'socket'
require 'stringio'

STATUS_PHRASES = {
  200 => 'OK', 201 => 'Created', 204 => 'No Content',
  301 => 'Moved Permanently', 302 => 'Found',
  400 => 'Bad Request', 401 => 'Unauthorized',
  403 => 'Forbidden', 404 => 'Not Found',
  405 => 'Method Not Allowed', 500 => 'Internal Server Error',
}.freeze

def parse_request(client)
  request_line = client.gets&.chomp
  return nil unless request_line && !request_line.empty?

  method, full_path, http_version = request_line.split(' ', 3)
  path, query_string = full_path.split('?', 2)

  headers = {}
  while (line = client.gets&.chomp) && !line.empty?
    name, value = line.split(': ', 2)
    headers[name] = value
  end

  body = ''
  if (length = headers['Content-Length']&.to_i) && length > 0
    body = client.read(length)
  end

  env = {
    'REQUEST_METHOD'    => method,
    'SCRIPT_NAME'       => '',
    'PATH_INFO'         => path,
    'QUERY_STRING'      => query_string || '',
    'SERVER_NAME'       => 'localhost',
    'SERVER_PORT'       => '9292',
    'SERVER_PROTOCOL'   => http_version || 'HTTP/1.1',
    'rack.version'      => [1, 3],
    'rack.input'        => StringIO.new(body),
    'rack.errors'       => $stderr,
    'rack.multithread'  => false,
    'rack.multiprocess' => false,
    'rack.run_once'     => false,
    'rack.url_scheme'   => 'http',
  }

  headers.each do |name, value|
    key = case name
          when 'Content-Type'   then 'CONTENT_TYPE'
          when 'Content-Length' then 'CONTENT_LENGTH'
          else "HTTP_#{name.upcase.tr('-', '_')}"
          end
    env[key] = value
  end

  env
end

def send_response(client, status, headers, body)
  phrase = STATUS_PHRASES[status] || 'Unknown'
  client.write("HTTP/1.1 #{status} #{phrase}\r\n")
  headers.each { |name, value| client.write("#{name}: #{value}\r\n") }
  client.write("\r\n")
  body.each { |chunk| client.write(chunk) }
  body.close if body.respond_to?(:close)
end

def run(app, port: 9292)
  server = TCPServer.new('0.0.0.0', port)
  puts "TinyServer listening on http://localhost:#{port}"

  loop do
    client = server.accept

    begin
      env = parse_request(client)

      if env
        status, headers, body = app.call(env)
        send_response(client, status, headers, body)
      end
    rescue => e
      $stderr.puts "Error handling request: #{e.message}"
      $stderr.puts e.backtrace.first(5).join("\n")

      error_body = "Internal Server Error\n"
      client.write("HTTP/1.1 500 Internal Server Error\r\n")
      client.write("Content-Type: text/plain\r\n")
      client.write("Content-Length: #{error_body.bytesize}\r\n")
      client.write("\r\n")
      client.write(error_body)
    ensure
      client.close
    end
  end
end
```

## Running It with a Real App

Let's plug in the notes app from the previous chapter:

```ruby
# run_notes.rb
require_relative 'tiny_server'
require_relative 'app'  # the NotesApp from the previous chapter

run NotesApp.new, port: 9292
```

```bash
$ ruby run_notes.rb
TinyServer listening on http://localhost:9292
```

```bash
$ curl -s http://localhost:9292/notes
[]

$ curl -s -X POST http://localhost:9292/notes \
  -H 'Content-Type: application/json' \
  -d '{"content": "It works"}' | jq .
{"id":1,"content":"It works","created":"2026-02-19T12:00:00+00:00"}

$ curl -s http://localhost:9292/notes | jq .
[{"id":1,"content":"It works","created":"2026-02-19T12:00:00+00:00"}]
```

Your handwritten server, running your handwritten app. Real HTTP, real TCP sockets.

## Making It Threaded

The current server handles one request at a time — the next `server.accept` doesn't run until the current request is finished. For a learning tool, fine. For anything resembling concurrent use, we need threads:

```ruby
def run(app, port: 9292)
  server = TCPServer.new('0.0.0.0', port)
  puts "TinyServer (threaded) on http://localhost:#{port}"

  loop do
    client = server.accept

    Thread.new(client) do |conn|
      begin
        env = parse_request(conn)
        if env
          status, headers, body = app.call(env)
          send_response(conn, status, headers, body)
        end
      rescue => e
        $stderr.puts "Error: #{e.message}"
      ensure
        conn.close
      end
    end
  end
end
```

Each connection gets its own thread. The main loop immediately returns to `accept`, ready for the next connection. This is essentially what WEBrick does (minus SSL, keep-alive, virtual host support, and a decade of edge-case handling).

## What We're Not Handling

A production HTTP/1.1 server needs to handle:

- **Keep-alive connections**: HTTP/1.1 keeps connections open by default. Our server closes after every response, which is valid but wasteful.
- **Chunked transfer encoding**: When `Content-Length` is unknown at response time, you can send data in chunks.
- **HTTP pipelining**: Multiple requests on the same connection before any response.
- **Request timeouts**: A client that connects and never sends data will tie up a thread forever.
- **Very large bodies**: We read the entire body into memory. For file uploads, you'd want streaming.
- **SSL/TLS**: Everything above is cleartext.
- **HTTP/2**: A binary protocol with multiplexing; fundamentally different from HTTP/1.1.

Puma, the default Rails server, handles all of these. It's about 10,000 lines of code. Our server is about 80. The gap is instructive — those 9,920 lines are solving real, hard problems. But the core idea — parse a hash, call an object, serialize the result — is in our 80 lines.

## The Moment

Here it is: **the only thing a web server does is build a hash and call your code.** The hash has a few required keys. Your code returns a three-element array. The server turns that array into text and sends it over a socket.

When Puma says it "runs Rack applications," this is what it means. When we say "Rack-compatible server," we mean "a server that knows how to build this specific hash and interpret this specific array." The protocol is simple enough that we just implemented a conforming server in under a hundred lines.

Next: the middleware chain that sits between the server and your app.
