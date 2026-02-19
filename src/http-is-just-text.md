# HTTP Is Just Text

Before we talk about Rack, before we talk about Ruby, we need to talk about what's actually going on between the browser and your application. Because once you see it, you can't unsee it, and everything you've been doing will make more sense.

Open a terminal. We're going to make an HTTP request without a browser, without a library, without anything except `nc` (netcat) and our fingers.

## The Actual Wire

```bash
$ printf "GET / HTTP/1.1\r\nHost: example.com\r\n\r\n" | nc example.com 80
```

You'll see something like:

```
HTTP/1.1 200 OK
Content-Encoding: gzip
Accept-Ranges: bytes
Age: 604476
Cache-Control: max-age=604800
Content-Type: text/html; charset=UTF-8
Date: Mon, 19 Feb 2026 12:00:00 GMT
Etag: "3147526947+gzip"
Expires: Mon, 26 Feb 2026 12:00:00 GMT
Last-Modified: Thu, 17 Oct 2019 07:18:26 GMT
Server: ECS (nyb/1D2E)
Vary: Accept-Encoding
X-Cache: HIT
Content-Length: 648

<!doctype html>
...
```

That's it. That's HTTP. Text goes in, text comes out. The format is rigid but the transport is a TCP socket, which is just a reliable stream of bytes. HTTP doesn't care that those bytes happen to be ASCII text. The convention is that they are.

## The Request Format

An HTTP/1.1 request looks like this:

```
METHOD /path HTTP/1.1\r\n
Header-Name: header value\r\n
Another-Header: its value\r\n
\r\n
optional body here
```

The parts:

- **Request line**: `METHOD PATH HTTP-VERSION` — all on one line, `\r\n` terminated
- **Headers**: `Name: Value` pairs, one per line, `\r\n` terminated
- **Blank line**: A `\r\n` on its own signals end of headers
- **Body**: Optional. Present for POST/PUT, usually absent for GET. Length is specified in `Content-Length`.

Let's build one by hand:

```ruby
require 'socket'

# Open a TCP connection
socket = TCPSocket.new('httpbin.org', 80)

# Write a valid HTTP/1.1 request
request = [
  "GET /get HTTP/1.1",
  "Host: httpbin.org",
  "Accept: application/json",
  "Connection: close",
  "",  # blank line = end of headers
  ""   # body (empty)
].join("\r\n")

socket.write(request)

# Read the response
response = socket.read
socket.close

puts response
```

Run that. You'll get back a real HTTP response with JSON body. No gems, no frameworks. Just a TCP socket and text.

## The Response Format

The response format mirrors the request:

```
HTTP/1.1 STATUS_CODE REASON_PHRASE\r\n
Header-Name: header value\r\n
Another-Header: its value\r\n
\r\n
body content here
```

The status line is `HTTP-VERSION STATUS-CODE REASON-PHRASE`. The status code is what you check in your application code and what browsers act on. The reason phrase ("OK", "Not Found", "Internal Server Error") is informational and largely ignored by machines.

```ruby
# Parse an HTTP response by hand
response_text = <<~HTTP
  HTTP/1.1 200 OK\r
  Content-Type: text/plain\r
  Content-Length: 13\r
  \r
  Hello, World!
HTTP

lines = response_text.split("\r\n")

# First line is the status line
status_line = lines.shift
version, code, *reason = status_line.split(' ')
status_code = code.to_i

puts "Version: #{version}"  # HTTP/1.1
puts "Status:  #{status_code}"  # 200
puts "Reason:  #{reason.join(' ')}"  # OK

# Headers follow until the blank line
headers = {}
while (line = lines.shift) && !line.empty?
  name, value = line.split(': ', 2)
  headers[name] = value
end

puts "Headers: #{headers.inspect}"
# {"Content-Type" => "text/plain", "Content-Length" => "13"}

# Rest is body
body = lines.join("\r\n")
puts "Body: #{body}"  # Hello, World!
```

## What Servers Actually Do

A web server's job, stripped to its core:

1. Listen on a TCP port (usually 80 or 443)
2. Accept a connection
3. Read bytes until you have a complete HTTP request
4. Parse the request into a structured format
5. Do something with it (your application code runs here)
6. Format the response back into HTTP text
7. Write it to the socket
8. Close the connection (or keep it open for HTTP/1.1 keep-alive)

Step 5 is the only step that varies between applications. Steps 1-4 and 6-8 are the same for every web application ever written. Rack is what formalizes the handoff at step 5.

## What Headers Are Actually Doing

Headers are metadata about the request or response. Nothing more. They're just key-value pairs that tell the other side how to interpret what it's receiving.

Some important ones:

**Request headers you should know:**
- `Host` — which domain the client wants (required in HTTP/1.1, because one IP can serve many domains)
- `Accept` — what content types the client can handle
- `Content-Type` — what format the request body is in (important for POST)
- `Content-Length` — how many bytes in the body
- `Cookie` — cookies, serialized as `name=value; name2=value2`
- `Authorization` — authentication credentials

**Response headers you should know:**
- `Content-Type` — what format the body is in, e.g. `text/html; charset=utf-8`
- `Content-Length` — how many bytes in the body (so the client knows when it's done)
- `Set-Cookie` — asks the client to store a cookie
- `Location` — used with 301/302 redirects to specify where to go
- `Cache-Control` — caching instructions

Your framework sets most of these for you. But it's worth knowing they're just text in a predictable format.

## POST Bodies

When you submit a form, the browser sends a POST request with the form data in the body. The format depends on the `Content-Type` header:

**`application/x-www-form-urlencoded`** (the default):
```
name=Alice&age=30&city=Auckland
```

**`multipart/form-data`** (for file uploads):
```
--boundary123
Content-Disposition: form-data; name="name"

Alice
--boundary123
Content-Disposition: form-data; name="file"; filename="photo.jpg"
Content-Type: image/jpeg

[binary file data here]
--boundary123--
```

**`application/json`** (for API clients):
```json
{"name": "Alice", "age": 30, "city": "Auckland"}
```

When Rails gives you `params[:name]`, it has parsed one of these formats. When it fails in production with a cryptic body-parsing error, now you know where to look.

## The Moment Where It Clicks

Here's the thing: HTTP is a protocol designed in 1991 and finalized in 1996. It was designed by people who expected it to be implemented in C and read by humans for debugging. The fact that it's text is a feature, not a coincidence.

This is why you can debug HTTP with `nc`, with `curl -v`, with browser DevTools. This is why log lines make sense. This is why you can write a minimal HTTP server in a hundred lines of Ruby (we will).

HTTP/2 and HTTP/3 are binary protocols, which is why you can't `nc` them as easily. But HTTP/1.1 is still everywhere, and Rack was designed around it.

## Putting It Together: A Minimal HTTP Interaction in Ruby

```ruby
require 'socket'

# Server side: accept one request and respond
server = TCPServer.new(2345)
puts "Listening on :2345"

Thread.new do
  client = server.accept

  # Read the request line
  request_line = client.gets
  puts "Got: #{request_line.chomp}"

  # Read headers until blank line
  headers = {}
  while (line = client.gets.chomp) && !line.empty?
    name, value = line.split(': ', 2)
    headers[name] = value
  end

  # Build a response
  body = "Hello from a real HTTP server!\n"
  response = [
    "HTTP/1.1 200 OK",
    "Content-Type: text/plain",
    "Content-Length: #{body.bytesize}",
    "Connection: close",
    "",
    body
  ].join("\r\n")

  client.write(response)
  client.close
  server.close
end

# Client side: make a request
sleep(0.1) # give server a moment to start

require 'socket'
socket = TCPSocket.new('localhost', 2345)
socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
puts socket.read
socket.close
```

Save that as `http_demo.rb` and run it:

```bash
$ ruby http_demo.rb
Listening on :2345
Got: GET / HTTP/1.1
HTTP/1.1 200 OK
Content-Type: text/plain
Content-Length: 31
Connection: close

Hello from a real HTTP server!
```

You just wrote an HTTP server and client from scratch. It handles exactly one request. It has no routing. It ignores the path. But it speaks valid HTTP and it works. Everything that comes after this chapter — Rack, Roda, Rails — is elaborating on this foundation.

The next question is: how do you plug your Ruby code into this in a standardized way, so that your code can run on any HTTP server, and any HTTP server can run your code? That's what Rack solves.
