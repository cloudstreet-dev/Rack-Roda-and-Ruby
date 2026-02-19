# Rack, Roda, and Ruby

> Rails is just a callable. Sinatra is just a callable. So is Roda. This book strips away the magic of Ruby web development, shows you exactly what Rack is doing under the hood, and teaches you to build from first principles. Know your tools. Really know them.

A [CloudStreet](https://github.com/cloudstreet-dev) book.

**Read online:** https://cloudstreet-dev.github.io/Rack-Roda-and-Ruby/

---

## What This Is

You've been writing Ruby web applications. You understand routes, controllers, middleware, responses. You know how to use the framework. But do you know what the framework is? Do you know what happens before your code runs, or what "Rack compatibility" actually means, or why every Ruby web framework can be dropped into a config.ru?

This book answers those questions. It starts at the HTTP wire protocol, builds up through the Rack specification, constructs working servers and middleware from scratch, and then examines how Roda—one of the cleanest Ruby web frameworks—sits on top of all of it. By the end, you'll understand not just how to use these tools but why they are the way they are.

The code in this book actually runs. The explanations are accurate. The humor is dry.

---

## Table of Contents

### Introduction
- [The Lie You've Been Living](src/introduction.md)

### Part I — The Foundation
- [HTTP Is Just Text](src/http-is-just-text.md)
- [What Rails and Sinatra Are Actually Doing](src/what-frameworks-do.md)

### Part II — Rack
- [The Rack Spec (It Fits on a Napkin)](src/rack/the-spec.md)
- [Your First Rack App (No Training Wheels)](src/rack/first-app.md)
- [Build a Rack Server from Scratch](src/rack/server-from-scratch.md)
- [Middleware: Turtles All the Way Down](src/rack/middleware.md)
- [Routing Without a Framework (It's Just String Matching)](src/rack/routing.md)
- [Request and Response Objects (DIY Edition)](src/rack/request-response.md)

### Part III — Roda
- [Why Rack Alone Isn't Enough](src/roda/why-rack-alone-isnt-enough.md)
- [The Routing Tree (Roda's Big Idea)](src/roda/routing-tree.md)
- [Your First Roda App](src/roda/first-app.md)
- [Roda's Plugin System (Opt-In Everything)](src/roda/plugins.md)
- [Middleware in Roda](src/roda/middleware.md)
- [Testing Roda Apps](src/roda/testing.md)

### Part IV — Patterns
- [Roll Your Own Mini-Framework](src/patterns/roll-your-own.md)
- [Rails vs Sinatra vs Roda](src/patterns/comparing-frameworks.md)

### Conclusion
- [You Know Too Much Now](src/conclusion.md)

---

## Building Locally

You'll need [mdBook](https://rust-lang.github.io/mdBook/guide/installation.html) installed:

```bash
cargo install mdbook
```

Then:

```bash
git clone https://github.com/cloudstreet-dev/Rack-Roda-and-Ruby
cd Rack-Roda-and-Ruby
mdbook serve --open
```

This starts a local server at `http://localhost:3000` with live reloading.

To build a static copy:

```bash
mdbook build
# Output is in ./book/
```

---

## License

This book is released under [CC0 1.0 Universal](LICENSE) — public domain. Take it, adapt it, use it in courses, translate it, whatever. Attribution is appreciated but not required.

---

## Acknowledgements

Thank you to **Georgiy Treyvus** for coming up with the idea for this book.

---

## The CloudStreet Series

This book is part of the CloudStreet series of technical books at [github.com/cloudstreet-dev](https://github.com/cloudstreet-dev). The series covers practical Ruby, web fundamentals, and the kind of knowledge that makes you genuinely better rather than just more familiar with a particular framework's DSL.
