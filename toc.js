// Populate the sidebar
//
// This is a script, and not included directly in the page, to control the total size of the book.
// The TOC contains an entry for each page, so if each page includes a copy of the TOC,
// the total size of the page becomes O(n**2).
class MDBookSidebarScrollbox extends HTMLElement {
    constructor() {
        super();
    }
    connectedCallback() {
        this.innerHTML = '<ol class="chapter"><li class="chapter-item expanded affix "><a href="introduction.html">Introduction</a></li><li class="chapter-item expanded affix "><li class="part-title">Part I — The Foundation</li><li class="chapter-item expanded "><a href="http-is-just-text.html"><strong aria-hidden="true">1.</strong> HTTP Is Just Text</a></li><li class="chapter-item expanded "><a href="what-frameworks-do.html"><strong aria-hidden="true">2.</strong> What Rails and Sinatra Are Actually Doing</a></li><li class="chapter-item expanded affix "><li class="part-title">Part II — Rack</li><li class="chapter-item expanded "><a href="rack/the-spec.html"><strong aria-hidden="true">3.</strong> The Rack Spec (It Fits on a Napkin)</a></li><li class="chapter-item expanded "><a href="rack/first-app.html"><strong aria-hidden="true">4.</strong> Your First Rack App (No Training Wheels)</a></li><li class="chapter-item expanded "><a href="rack/server-from-scratch.html"><strong aria-hidden="true">5.</strong> Build a Rack Server from Scratch</a></li><li class="chapter-item expanded "><a href="rack/middleware.html"><strong aria-hidden="true">6.</strong> Middleware: Turtles All the Way Down</a></li><li class="chapter-item expanded "><a href="rack/routing.html"><strong aria-hidden="true">7.</strong> Routing Without a Framework (It&#39;s Just String Matching)</a></li><li class="chapter-item expanded "><a href="rack/request-response.html"><strong aria-hidden="true">8.</strong> Request and Response Objects (DIY Edition)</a></li><li class="chapter-item expanded affix "><li class="part-title">Part III — Roda</li><li class="chapter-item expanded "><a href="roda/why-rack-alone-isnt-enough.html"><strong aria-hidden="true">9.</strong> Why Rack Alone Isn&#39;t Enough</a></li><li class="chapter-item expanded "><a href="roda/routing-tree.html"><strong aria-hidden="true">10.</strong> The Routing Tree (Roda&#39;s Big Idea)</a></li><li class="chapter-item expanded "><a href="roda/first-app.html"><strong aria-hidden="true">11.</strong> Your First Roda App</a></li><li class="chapter-item expanded "><a href="roda/plugins.html"><strong aria-hidden="true">12.</strong> Roda&#39;s Plugin System (Opt-In Everything)</a></li><li class="chapter-item expanded "><a href="roda/middleware.html"><strong aria-hidden="true">13.</strong> Middleware in Roda</a></li><li class="chapter-item expanded "><a href="roda/testing.html"><strong aria-hidden="true">14.</strong> Testing Roda Apps</a></li><li class="chapter-item expanded affix "><li class="part-title">Part IV — Patterns</li><li class="chapter-item expanded "><a href="patterns/roll-your-own.html"><strong aria-hidden="true">15.</strong> Roll Your Own Mini-Framework (For Fun and Understanding)</a></li><li class="chapter-item expanded "><a href="patterns/comparing-frameworks.html"><strong aria-hidden="true">16.</strong> Rails vs Sinatra vs Roda (Now That You Know What They Are)</a></li><li class="chapter-item expanded affix "><li class="spacer"></li><li class="chapter-item expanded affix "><a href="conclusion.html">You Know Too Much Now</a></li></ol>';
        // Set the current, active page, and reveal it if it's hidden
        let current_page = document.location.href.toString().split("#")[0].split("?")[0];
        if (current_page.endsWith("/")) {
            current_page += "index.html";
        }
        var links = Array.prototype.slice.call(this.querySelectorAll("a"));
        var l = links.length;
        for (var i = 0; i < l; ++i) {
            var link = links[i];
            var href = link.getAttribute("href");
            if (href && !href.startsWith("#") && !/^(?:[a-z+]+:)?\/\//.test(href)) {
                link.href = path_to_root + href;
            }
            // The "index" page is supposed to alias the first chapter in the book.
            if (link.href === current_page || (i === 0 && path_to_root === "" && current_page.endsWith("/index.html"))) {
                link.classList.add("active");
                var parent = link.parentElement;
                if (parent && parent.classList.contains("chapter-item")) {
                    parent.classList.add("expanded");
                }
                while (parent) {
                    if (parent.tagName === "LI" && parent.previousElementSibling) {
                        if (parent.previousElementSibling.classList.contains("chapter-item")) {
                            parent.previousElementSibling.classList.add("expanded");
                        }
                    }
                    parent = parent.parentElement;
                }
            }
        }
        // Track and set sidebar scroll position
        this.addEventListener('click', function(e) {
            if (e.target.tagName === 'A') {
                sessionStorage.setItem('sidebar-scroll', this.scrollTop);
            }
        }, { passive: true });
        var sidebarScrollTop = sessionStorage.getItem('sidebar-scroll');
        sessionStorage.removeItem('sidebar-scroll');
        if (sidebarScrollTop) {
            // preserve sidebar scroll position when navigating via links within sidebar
            this.scrollTop = sidebarScrollTop;
        } else {
            // scroll sidebar to current active section when navigating via "next/previous chapter" buttons
            var activeSection = document.querySelector('#sidebar .active');
            if (activeSection) {
                activeSection.scrollIntoView({ block: 'center' });
            }
        }
        // Toggle buttons
        var sidebarAnchorToggles = document.querySelectorAll('#sidebar a.toggle');
        function toggleSection(ev) {
            ev.currentTarget.parentElement.classList.toggle('expanded');
        }
        Array.from(sidebarAnchorToggles).forEach(function (el) {
            el.addEventListener('click', toggleSection);
        });
    }
}
window.customElements.define("mdbook-sidebar-scrollbox", MDBookSidebarScrollbox);
