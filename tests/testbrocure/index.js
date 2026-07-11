// Layered parallax: each item lags behind normal scroll by an amount set by
// its data-speed. Since every item here is a normal (non-transformed) child
// that already scrolls at a full -scrollY, adding translateY(offset * speed)
// cancels part of that: speed near 1 cancels almost all of it (near-frozen ->
// reads as "distant"), speed near 0 cancels almost none of it (moves with
// the page -> reads as "close").
//
// Each group's "offset" is measured from its own container's natural
// (untransformed) document top, not raw page scrollY. That distinction only
// matters once a container sits far down the page: raw scrollY is already in
// the thousands by the time you reach a mid-page section, so applying it
// directly would blow the transform far past that section's own small
// clipping box. Measuring from the container's own top means the offset
// starts near zero right as that section comes into play, regardless of
// where it sits in the document.
//
// The mid-page banner's quote (.parallax-banner-overlay) gets the lag, not
// the outer .parallax-banner box itself: the outer box has overflow: hidden,
// so transforming only its child lets that clipping contain the lag (the
// quote fades out at the banner's own top/bottom edge instead of bleeding
// into the section after it, the same way .hero clips its own lagging
// .hero-content).
(function () {
    function makeGroup(containerSelector, itemsSelector) {
        var container = document.querySelector(containerSelector);
        if (!container) return null;
        var scrollY = window.scrollY || window.pageYOffset;
        return {
            baseTop: container.getBoundingClientRect().top + scrollY,
            items: Array.prototype.slice.call(document.querySelectorAll(itemsSelector)),
        };
    }

    var groups = [
        makeGroup('.hero', '.parallax-layer, .hero-content'),
        makeGroup('.parallax-banner', '.parallax-banner-overlay'),
    ].filter(Boolean);

    function updateParallax() {
        var scrollY = window.scrollY || window.pageYOffset;
        groups.forEach(function (group) {
            var offset = scrollY - group.baseTop;
            group.items.forEach(function (item) {
                var speed = parseFloat(item.getAttribute('data-speed')) || 0.2;
                item.style.transform = 'translateY(' + (offset * speed) + 'px)';
            });
        });
    }

    var ticking = false;
    window.addEventListener('scroll', function () {
        if (!ticking) {
            requestAnimationFrame(function () {
                updateParallax();
                ticking = false;
            });
            ticking = true;
        }
    });

    updateParallax();
})();

// Fade amenity cards in as they enter the viewport.
(function () {
    var cards = document.querySelectorAll('.amenity-card');
    if (!('IntersectionObserver' in window) || !cards.length) {
        cards.forEach(function (card) { card.classList.add('in-view'); });
        return;
    }

    var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (entry.isIntersecting) {
                entry.target.classList.add('in-view');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.2 });

    cards.forEach(function (card) { observer.observe(card); });
})();

// Booking form: this is a static demo page, so simulate a booking confirmation
// instead of actually submitting anywhere.
(function () {
    var form = document.getElementById('booking-form');
    if (!form) return;

    var confirmation = document.createElement('p');
    confirmation.className = 'booking-confirmation';
    confirmation.textContent = 'Your voyage to the Grey Havens has been booked. A raven will confirm shortly.';
    form.appendChild(confirmation);

    form.addEventListener('submit', function (event) {
        event.preventDefault();
        confirmation.classList.add('show');
        confirmation.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
})();
