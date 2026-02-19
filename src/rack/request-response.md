# Request and Response Objects (DIY Edition)

By now you've been reading `env['REQUEST_METHOD']` and returning `[200, headers, body]` directly. This works, but it's verbose. Real applications build thin wrapper objects around the raw data structures to make the common cases easier.

The `rack` gem ships with `Rack::Request` and `Rack::Response`. They're good. But let's build our own versions first, so we understand what they're doing and why.

## The Problem with Raw Env

Accessing request data from the raw env hash has a few annoyances:

```ruby
# Reading headers is inconsistent
host         = env['HTTP_HOST']            # most headers
content_type = env['CONTENT_TYPE']        # except Content-Type
content_len  = env['CONTENT_LENGTH']      # and Content-Length

# Checking HTTP method
is_get  = env['REQUEST_METHOD'] == 'GET'
is_post = env['REQUEST_METHOD'] == 'POST'

# Reading the body (destructive! can only read once)
body = env['rack.input'].read

# Parsing query string
require 'uri'
params = URI.decode_www_form(env['QUERY_STRING']).to_h

# Getting the full URL
scheme = env['rack.url_scheme']
host   = env['HTTP_HOST']
path   = env['PATH_INFO']
qs     = env['QUERY_STRING']
url    = "#{scheme}://#{host}#{path}"
url   += "?#{qs}" unless qs.empty?
```

None of this is wrong, but it's tedious. A request object wraps these lookups in named methods.

## Building a Request Wrapper

```ruby
class Request
  attr_reader :env

  def initialize(env)
    @env = env
  end

  # HTTP method
  def request_method = env['REQUEST_METHOD']
  def get?    = request_method == 'GET'
  def post?   = request_method == 'POST'
  def put?    = request_method == 'PUT'
  def patch?  = request_method == 'PATCH'
  def delete? = request_method == 'DELETE'
  def head?   = request_method == 'HEAD'

  # Path and query
  def path         = env['PATH_INFO']
  def query_string = env['QUERY_STRING']
  def script_name  = env['SCRIPT_NAME']
  def full_path    = query_string.empty? ? path : "#{path}?#{query_string}"

  # URL construction
  def scheme = env['rack.url_scheme'] || 'http'
  def host   = env['HTTP_HOST'] || env['SERVER_NAME']
  def port   = env['SERVER_PORT']
  def url    = "#{scheme}://#{host}#{full_path}"

  # Headers (Rack-normalized: HTTP_ACCEPT -> Accept)
  def headers
    @headers ||= env.each_with_object({}) do |(key, value), h|
      if key.start_with?('HTTP_')
        name = key.sub('HTTP_', '').split('_').map(&:capitalize).join('-')
        h[name] = value
      elsif key == 'CONTENT_TYPE'
        h['Content-Type'] = value
      elsif key == 'CONTENT_LENGTH'
        h['Content-Length'] = value
      end
    end
  end

  def content_type   = env['CONTENT_TYPE']
  def content_length = env['CONTENT_LENGTH']&.to_i

  # Individual header lookup — normalizes to Rack format
  def [](header_name)
    key = "HTTP_#{header_name.upcase.tr('-', '_')}"
    env[key] || env[header_name.upcase.tr('-', '_')]
  end

  # Query parameters (parsed and decoded)
  def query_params
    @query_params ||= parse_query(query_string)
  end

  # POST body params (for application/x-www-form-urlencoded)
  def post_params
    @post_params ||= if content_type&.include?('application/x-www-form-urlencoded')
      parse_query(body_string)
    else
      {}
    end
  end

  # Merged params: query + post body (query takes precedence on collision)
  def params
    @params ||= post_params.merge(query_params)
  end

  # Raw body (reads once, then cached)
  def body
    env['rack.input']
  end

  def body_string
    @body_string ||= begin
      body.rewind  # reset in case it was partially read
      body.read
    end
  end

  # JSON body parsing
  def json
    @json ||= if content_type&.include?('application/json')
      require 'json'
      JSON.parse(body_string)
    end
  end

  # Cookies
  def cookies
    @cookies ||= parse_cookies(env['HTTP_COOKIE'] || '')
  end

  # IP address (respects X-Forwarded-For if behind a proxy)
  def ip
    env['HTTP_X_FORWARDED_FOR']&.split(',')&.first&.strip ||
      env['REMOTE_ADDR']
  end

  # Is this an AJAX request?
  def xhr?
    env['HTTP_X_REQUESTED_WITH']&.downcase == 'xmlhttprequest'
  end

  # What content types does the client accept?
  def accepts?(mime_type)
    accept = env['HTTP_ACCEPT'] || '*/*'
    accept.include?(mime_type) || accept.include?('*/*')
  end

  private

  def parse_query(string)
    return {} if string.nil? || string.empty?
    require 'uri'
    URI.decode_www_form(string).each_with_object({}) do |(k, v), h|
      if h.key?(k)
        h[k] = Array(h[k]) << v
      else
        h[k] = v
      end
    end
  end

  def parse_cookies(string)
    string.split('; ').each_with_object({}) do |pair, h|
      name, value = pair.split('=', 2)
      h[name] = value if name
    end
  end
end
```

## Building a Response Helper

The response is `[status, headers, body]`. Building it manually is fine for simple cases but gets tedious when you're setting multiple headers or building the body incrementally.

```ruby
class Response
  attr_accessor :status
  attr_reader :headers

  def initialize(status = 200, headers = {})
    @status  = status
    @headers = {'Content-Type' => 'text/html; charset=utf-8'}.merge(headers)
    @body    = []
    @finished = false
  end

  # Write to the body buffer
  def write(str)
    raise 'Response already finished' if @finished
    @body << str.to_s
    self
  end

  def <<(str) = write(str)

  # Set a header
  def []=(name, value)
    @headers[name] = value
  end

  def [](name)
    @headers[name]
  end

  # Common response types
  def set_cookie(name, value, options = {})
    cookie = "#{name}=#{value}"
    cookie += "; Path=#{options[:path] || '/'}"
    cookie += "; HttpOnly" if options[:http_only] != false
    cookie += "; Secure"   if options[:secure]
    cookie += "; SameSite=#{options[:same_site]}" if options[:same_site]
    if options[:expires]
      cookie += "; Expires=#{options[:expires].httpdate}"
    end
    # Multiple Set-Cookie headers need to be handled carefully
    existing = @headers['Set-Cookie']
    @headers['Set-Cookie'] = existing ? "#{existing}\n#{cookie}" : cookie
  end

  def delete_cookie(name)
    set_cookie(name, '', expires: Time.at(0))
  end

  # Redirect helpers
  def redirect(location, status = 302)
    @status = status
    @headers['Location'] = location
    @body = []
    self
  end

  # Finish: set Content-Length and return the Rack triple
  def finish
    @finished = true
    body = @body

    unless @headers['Content-Length']
      size = body.sum(&:bytesize)
      @headers['Content-Length'] = size.to_s
    end

    [@status, @headers, body]
  end

  # Convenience: finish with a body written all at once
  def self.text(body, status: 200)
    r = new(status, 'Content-Type' => 'text/plain')
    r.write(body)
    r.finish
  end

  def self.html(body, status: 200)
    r = new(status, 'Content-Type' => 'text/html; charset=utf-8')
    r.write(body)
    r.finish
  end

  def self.json(data, status: 200)
    require 'json'
    body = JSON.generate(data)
    r = new(status, 'Content-Type' => 'application/json')
    r.write(body)
    r.finish
  end

  def self.redirect(location, status: 302)
    r = new(status)
    r.redirect(location, status)
    r.finish
  end
end
```

## Using Them Together

Here's our NotesApp rewritten with these helpers:

```ruby
require_relative 'request'
require_relative 'response'
require 'json'

class NotesApp
  def initialize
    @notes  = {}
    @next_id = 1
  end

  def call(env)
    req = Request.new(env)

    case [req.request_method, req.path]
    when ['GET', '/notes']
      Response.json(@notes.values)

    when ['POST', '/notes']
      create_note(req)

    else
      if (match = req.path.match(%r{\A/notes/(\d+)\z}))
        id = match[1].to_i
        case req.request_method
        when 'GET'    then show_note(id)
        when 'DELETE' then delete_note(id)
        else Response.json({'error' => 'Method not allowed'}, status: 405)
        end
      else
        Response.json({'error' => 'Not found'}, status: 404)
      end
    end
  end

  private

  def show_note(id)
    note = @notes[id]
    return Response.json({'error' => 'Not found'}, status: 404) unless note
    Response.json(note)
  end

  def create_note(req)
    data = req.json
    return Response.json({'error' => 'Invalid JSON'}, status: 400) unless data

    note = {
      'id'      => @next_id,
      'content' => data['content'].to_s,
      'created' => Time.now.iso8601,
    }
    @notes[@next_id] = note
    @next_id += 1

    Response.json(note, status: 201)
  rescue JSON::ParserError
    Response.json({'error' => 'Invalid JSON'}, status: 400)
  end

  def delete_note(id)
    return Response.json({'error' => 'Not found'}, status: 404) unless @notes.key?(id)
    @notes.delete(id)
    [204, {}, []]
  end
end
```

Cleaner. `req.json` instead of `JSON.parse(env['rack.input'].read)`. `Response.json(data)` instead of the three-line array construction.

## Rack's Built-in Versions

`Rack::Request` and `Rack::Response` do everything above, plus:

- `Rack::Request#params` handles multipart form data (file uploads)
- `Rack::Request#session` accesses the session (set by session middleware)
- `Rack::Response` handles `Transfer-Encoding: chunked` for streaming
- Both handle edge cases in encoding and parsing that our implementations skip

There's no reason to use our versions in production. But now you know what they are: thin wrappers that make the env hash and response array more ergonomic. Not magic. Not framework infrastructure. Just Ruby objects.

## The Body Is Lazy

One important detail about the response body: it's supposed to be lazy. The Rack spec says the body responds to `each`, and the server calls `each` to get the chunks. It doesn't have to be an Array.

This means you can stream large responses without loading everything into memory:

```ruby
class FileStreamer
  def initialize(path)
    @path = path
  end

  def each
    File.open(@path, 'rb') do |file|
      while (chunk = file.read(16_384))  # read 16KB at a time
        yield chunk
      end
    end
  end

  def close
    # nothing to close — File.open handles it
  end
end

# In a Rack app:
def call(env)
  [
    200,
    {
      'Content-Type'        => 'application/octet-stream',
      'Content-Disposition' => 'attachment; filename="large_file.bin"',
    },
    FileStreamer.new('/path/to/large_file.bin')
  ]
end
```

The server calls `.each` on the body, yields chunks to the client as they're read, and memory usage stays flat even for multi-gigabyte files. `Rack::Sendfile` takes this further — if the server supports it, you tell the server the file path and the server handles the streaming at the OS level, bypassing Ruby entirely.

## The Insight

Request and response objects are not architecture — they're ergonomics. The underlying data structures are still a hash and an array. The wrappers exist so you don't have to remember that `Content-Type` uses a different env key format than other headers, or that the body needs `Content-Length` set, or that `rack.input` might need to be rewound before reading.

When `Rack::Request` or `Rack::Response` does something unexpected, you can read its source. It's a short file. It's doing exactly what we just did.

This concludes the Rack section. You've seen the spec, built apps against it, written a server, implemented middleware, built a router, and wrapped the env in ergonomic objects. You know what's happening.

Next: why Rack alone still isn't quite enough for most applications.
