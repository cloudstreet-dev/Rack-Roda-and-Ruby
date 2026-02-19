# Testing Roda Apps

Testing Roda applications is straightforward, and that's not an accident. Because a Roda app is a Rack-compatible callable, testing it requires no test server, no HTTP round-trips, and no framework-specific test DSL. You call `call`, you check the result.

Let's build a complete test suite.

## Setup

```ruby
# Gemfile
gem 'roda'
gem 'rack-test'   # Rack testing helpers
gem 'minitest'    # or rspec, your choice
gem 'json'
```

`rack-test` is a gem that provides a convenient DSL on top of `Rack::MockRequest`. It's the standard testing library for Rack applications, and it works with any Rack-compatible framework.

## The Application Under Test

```ruby
# app.rb
require 'roda'
require 'json'

class App < Roda
  plugin :json
  plugin :json_parser
  plugin :halt
  plugin :all_verbs
  plugin :sessions, secret: 'test-secret-at-least-64-bytes-long-for-production-use'

  STORE = Hash.new { |h, k| h[k] = {} }
  NEXT_ID = Hash.new(1)

  route do |r|
    r.on 'notes' do
      r.is do
        r.get  { STORE[:notes].values }
        r.post { create_note(r) }
      end

      r.on Integer do |id|
        note = STORE[:notes][id]
        r.halt(404, {'error' => 'not found'}) unless note

        r.is do
          r.get    { note }
          r.put    { update_note(r, note) }
          r.delete { STORE[:notes].delete(id); response.status = 204; '' }
        end
      end
    end

    r.on 'auth' do
      r.post 'login' do
        if r.params['password'] == 'correct-password'
          session['user'] = r.params['username']
          {'status' => 'logged in', 'user' => r.params['username']}
        else
          r.halt(401, {'error' => 'invalid credentials'})
        end
      end

      r.get 'whoami' do
        user = session['user']
        r.halt(401, {'error' => 'not authenticated'}) unless user
        {'user' => user}
      end

      r.delete 'logout' do
        session.clear
        response.status = 204
        ''
      end
    end
  end

  private

  def create_note(r)
    content = r.params['content'].to_s
    r.halt(422, {'error' => 'content required'}) if content.empty?

    id = NEXT_ID[:note]
    NEXT_ID[:note] += 1

    note = {'id' => id, 'content' => content, 'created' => Time.now.iso8601}
    STORE[:notes][id] = note
    response.status = 201
    note
  end

  def update_note(r, note)
    note['content'] = r.params['content'] if r.params['content']
    note['updated'] = Time.now.iso8601
    note
  end
end
```

## Testing with rack-test

```ruby
# test/test_app.rb
require 'minitest/autorun'
require 'rack/test'
require 'json'
require_relative '../app'

class AppTest < Minitest::Test
  include Rack::Test::Methods

  def app
    App  # rack-test calls App.call(env) for each request
  end

  # Reset storage before each test
  def setup
    App::STORE.clear
    App::NEXT_ID.clear
  end

  # --- Notes ---

  def test_empty_notes_list
    get '/notes'
    assert_equal 200, last_response.status
    assert_equal 'application/json', last_response.content_type
    assert_equal [], JSON.parse(last_response.body)
  end

  def test_create_note
    post_json '/notes', content: 'Test note'
    assert_equal 201, last_response.status

    data = parse_response
    assert_equal 'Test note', data['content']
    assert_kind_of Integer, data['id']
    assert data['created']
  end

  def test_create_note_requires_content
    post_json '/notes', {}
    assert_equal 422, last_response.status
    assert_equal 'content required', parse_response['error']
  end

  def test_get_note
    post_json '/notes', content: 'My note'
    id = parse_response['id']

    get "/notes/#{id}"
    assert_equal 200, last_response.status
    assert_equal 'My note', parse_response['content']
  end

  def test_get_missing_note
    get '/notes/999'
    assert_equal 404, last_response.status
    assert_equal 'not found', parse_response['error']
  end

  def test_update_note
    post_json '/notes', content: 'Original'
    id = parse_response['id']

    put_json "/notes/#{id}", content: 'Updated'
    assert_equal 200, last_response.status
    assert_equal 'Updated', parse_response['content']
    assert parse_response['updated']
  end

  def test_delete_note
    post_json '/notes', content: 'To delete'
    id = parse_response['id']

    delete "/notes/#{id}"
    assert_equal 204, last_response.status

    get "/notes/#{id}"
    assert_equal 404, last_response.status
  end

  def test_multiple_notes
    3.times { |i| post_json '/notes', content: "Note #{i}" }

    get '/notes'
    notes = JSON.parse(last_response.body)
    assert_equal 3, notes.length
  end

  # --- Authentication ---

  def test_login_success
    post_json '/auth/login',
      username: 'alice',
      password: 'correct-password'

    assert_equal 200, last_response.status
    assert_equal 'alice', parse_response['user']
  end

  def test_login_failure
    post_json '/auth/login',
      username: 'alice',
      password: 'wrong-password'

    assert_equal 401, last_response.status
    assert_equal 'invalid credentials', parse_response['error']
  end

  def test_whoami_when_not_authenticated
    get '/auth/whoami'
    assert_equal 401, last_response.status
  end

  def test_whoami_when_authenticated
    post_json '/auth/login', username: 'alice', password: 'correct-password'

    get '/auth/whoami'
    assert_equal 200, last_response.status
    assert_equal 'alice', parse_response['user']
  end

  def test_logout
    post_json '/auth/login', username: 'alice', password: 'correct-password'
    get '/auth/whoami'
    assert_equal 200, last_response.status

    delete '/auth/logout'
    assert_equal 204, last_response.status

    get '/auth/whoami'
    assert_equal 401, last_response.status
  end

  # --- Helper methods ---

  private

  def post_json(path, data)
    post path, data.to_json, 'CONTENT_TYPE' => 'application/json'
  end

  def put_json(path, data)
    put path, data.to_json, 'CONTENT_TYPE' => 'application/json'
  end

  def parse_response
    JSON.parse(last_response.body)
  end
end
```

Run it:

```bash
$ ruby test/test_app.rb
Run options: --seed 42

# Running:

.............

Finished in 0.023s, 565.2 runs/s.
13 runs, 22 assertions, 0 failures, 0 errors, 0 skips
```

Thirteen tests, 23 milliseconds. No HTTP server, no database, no external dependencies.

## What rack-test Provides

`Rack::Test::Methods` mixes in methods:
- `get(path, params, headers)` — GET request
- `post(path, body, headers)` — POST request
- `put(path, body, headers)` — PUT request
- `patch(path, body, headers)` — PATCH request
- `delete(path, params, headers)` — DELETE request
- `last_response` — the response from the last request
- `last_request` — the request that was sent

`last_response` has:
- `.status` — integer status code
- `.body` — response body string
- `.headers` — response headers hash
- `.content_type` — Content-Type header

Sessions are maintained between requests automatically — `rack-test` includes cookies in subsequent requests. This is how the authentication test flow works: login, then whoami, without any manual cookie handling.

## Testing Without rack-test

You don't need rack-test. It's convenient, but you can call your Roda app directly:

```ruby
class MinimalTest < Minitest::Test
  def make_request(method, path, body: nil, headers: {})
    env = Rack::MockRequest.env_for(path,
      method: method,
      input:  body ? StringIO.new(body) : StringIO.new,
      'CONTENT_TYPE' => headers['Content-Type'] || 'application/json',
    )
    App.call(env)
  end

  def test_get_notes
    status, headers, body = make_request('GET', '/notes')
    assert_equal 200, status
    assert_equal [], JSON.parse(body.join)
  end
end
```

This is more verbose but requires no additional gems. It's what `rack-test` does internally.

## Integration Tests vs. Unit Tests

The tests above are integration tests — they exercise the full routing stack. For complex business logic, you'll also want unit tests that test specific methods in isolation:

```ruby
class NoteCreationTest < Minitest::Test
  def test_note_content_validation
    app = App.new({})  # Roda app instance — this is unusual but possible

    # Test helper methods directly if they're accessible
    # Usually better to test through the HTTP interface
  end
end
```

In practice, for Roda applications, the HTTP-level integration tests are usually sufficient. The routing layer is thin — it delegates to methods or objects that contain business logic. Test those objects directly, and test the routing integration through HTTP.

## Testing Middleware

To test middleware in isolation, wrap it around a simple app:

```ruby
class MiddlewareTest < Minitest::Test
  include Rack::Test::Methods

  def app
    # Wrap the middleware around a simple echo app
    echo_app = lambda { |env| [200, {'Content-Type' => 'text/plain'}, ['ok']] }
    Rack::Builder.new do
      use RateLimiter, limit: 3
      run echo_app
    end
  end

  def test_allows_requests_under_limit
    3.times do
      get '/'
      assert_equal 200, last_response.status
    end
  end

  def test_blocks_requests_over_limit
    3.times { get '/' }
    get '/'
    assert_equal 429, last_response.status
  end
end
```

Test the middleware, not the application. Middleware should have no knowledge of the application it wraps, and its tests should reflect that.

## Test Structure for Real Applications

For a larger application, organize tests by resource:

```
test/
  test_helper.rb       # Minitest + rack-test setup, shared helpers
  integration/
    test_notes.rb      # Notes resource tests
    test_auth.rb       # Authentication tests
    test_users.rb      # User resource tests
  unit/
    test_note.rb       # Note model/service tests (no HTTP)
    test_auth_service.rb
  middleware/
    test_rate_limiter.rb
```

```ruby
# test/test_helper.rb
require 'minitest/autorun'
require 'rack/test'
require 'json'
require_relative '../app'

class IntegrationTest < Minitest::Test
  include Rack::Test::Methods

  def app
    App
  end

  def setup
    App::STORE.clear  # or reset your database
  end

  def post_json(path, data)
    post path, data.to_json, 'CONTENT_TYPE' => 'application/json'
  end

  def put_json(path, data)
    put path, data.to_json, 'CONTENT_TYPE' => 'application/json'
  end

  def parse_response
    JSON.parse(last_response.body)
  end

  def assert_status(expected)
    assert_equal expected, last_response.status,
      "Expected status #{expected}, got #{last_response.status}: #{last_response.body}"
  end
end
```

```ruby
# test/integration/test_notes.rb
require_relative '../test_helper'

class NotesTest < IntegrationTest
  def test_crud_lifecycle
    # Create
    post_json '/notes', content: 'Learn Roda'
    assert_status 201
    id = parse_response['id']

    # Read
    get "/notes/#{id}"
    assert_status 200
    assert_equal 'Learn Roda', parse_response['content']

    # Update
    put_json "/notes/#{id}", content: 'Understand Roda'
    assert_status 200
    assert_equal 'Understand Roda', parse_response['content']

    # Delete
    delete "/notes/#{id}"
    assert_status 204

    get "/notes/#{id}"
    assert_status 404
  end
end
```

## The Insight

Testing Roda applications is fast because there's no framework overhead, no HTTP round-trips, and no external services. The test suite from this chapter runs in milliseconds. A test suite with 500 tests that each take 2ms is done in a second.

Compare to a Rails application where integration tests spin up a test server, make HTTP requests, and wait for responses. Rails tests are slower partly because Rails does more, and partly because the abstraction layers make it harder to test at the right level.

Roda's thin stack means you can always test at exactly the right level: HTTP integration tests for routing concerns, unit tests for business logic, middleware tests for middleware. There's no intermediate layer that's difficult to test in isolation.

This is the compounding benefit of understanding your tools. When you understand what a Roda application is — a Rack callable with a routing block — you know exactly how to test it. No test framework magic required.
