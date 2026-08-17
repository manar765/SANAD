/* ==========================================================================
   SANAD — Home Page Interactions
   منصة سند — تفاعلات الصفحة الرئيسية
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    const navbar = document.getElementById('navbar');
    const navToggle = document.getElementById('navToggle');
    const toast = document.getElementById('toast');
    const progressBar = document.getElementById('progressBar');
    const backToTop = document.getElementById('backToTop');

    /* ---------------------------------------------------------
           1. Sticky navbar shadow + progress bar + back-to-top
        --------------------------------------------------------- */
    const onScroll = () => {
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        const progress = maxScroll > 0 ? window.scrollY / maxScroll : 0;
        if (progressBar) progressBar.style.transform = `scaleX(${progress})`;
        backToTop.classList.toggle('show', window.scrollY > 600);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();


    /* ---------------------------------------------------------
       Back To Top
    --------------------------------------------------------- */

    if (backToTop) {

        backToTop.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        /* ---------------------------------------------------------
           2. Mobile hamburger menu
        --------------------------------------------------------- */
        const closeMenu = () => {
            navbar.classList.remove('open');
            navToggle.setAttribute('aria-expanded', 'false');
            document.body.classList.remove('no-scroll');
        };


        if (navToggle) {

            navToggle.addEventListener('click', () => {
                const open = navbar.classList.toggle('open');
                navToggle.setAttribute('aria-expanded', String(open));
                document.body.classList.toggle('no-scroll', open);
            });

            /* ---------------------------------------------------------
               3. Smooth scrolling between sections
            --------------------------------------------------------- */
            document.querySelectorAll('a[href^="#"]').forEach((link) => {
                link.addEventListener('click', (event) => {
                    const id = link.getAttribute('href');
                    if (!id || id.length < 2) return;

                    const target = document.querySelector(id);
                    if (!target) return;

                    event.preventDefault();
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    closeMenu();
                });


                /* ---------------------------------------------------------
                   4. Placeholder links -> toast notification
                --------------------------------------------------------- */
                document.querySelectorAll('.placeholder').forEach((link) => {
                    link.addEventListener('click', (event) => {
                        event.preventDefault();
                        const page = link.dataset.page || 'هذه الخدمة';
                        showToast(`قريباً … صفحة «${page}» قيد الإعداد`);
                    });
                });

                let toastTimer;


                function showToast(message) {
                    toast.querySelector('span').textContent = message;
                    toast.classList.add('show');

                    clearTimeout(toastTimer);
                    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
                }


                /* ---------------------------------------------------------
                   5. Reveal animations on scroll
                --------------------------------------------------------- */
                const revealObserver = new IntersectionObserver(
                    (entries) => {
                        entries.forEach((entry) => {
                            if (entry.isIntersecting) {
                                entry.target.classList.add('visible');
                                revealObserver.unobserve(entry.target);
                            }
                        });
                    },
                    { threshold: 0.12 }
                );

                document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));

                /* ---------------------------------------------------------
                   6. Animated statistics counters
                --------------------------------------------------------- */
                const animateCounter = (el) => {
                    const target = Number(el.dataset.target);
                    const suffix = el.dataset.suffix || '';
                    const duration = 1600;

                    const start =
                        performance.now();


                    const tick = (now) => {
                        const progress = Math.min((now - start) / duration, 1);
                        const eased = 1 - Math.pow(1 - progress, 3);
                        el.textContent = Math.round(target * eased).toLocaleString('en-US') + suffix;

                        if (progress < 1) {

                            requestAnimationFrame(tick);

                        }

                    };


                    requestAnimationFrame(tick);

                };

                const counterObserver = new IntersectionObserver(
                    (entries) => {
                        entries.forEach((entry) => {
                            if (!entry.isIntersecting) return;

                            animateCounter(entry.target);
                            counterObserver.unobserve(entry.target);
                        });
                    },
                    { threshold: 0.4 }
                );

                document.querySelectorAll('.stat-value').forEach((el) => counterObserver.observe(el));

                /* ---------------------------------------------------------
                   7. Scrollspy — highlight active nav link
                --------------------------------------------------------- */
                const sections = document.querySelectorAll('section[id], footer[id]');
                const navLinks = document.querySelectorAll('.nav-link');

                const spyObserver = new IntersectionObserver(
                    (entries) => {
                        entries.forEach((entry) => {
                            if (!entry.isIntersecting) return;

                            const currentId = `#${entry.target.id}`;
                            navLinks.forEach((link) => {
                                const href = link.getAttribute('href');

                                if (!href || !href.startsWith('#')) return;

                                link.classList.toggle('active', href === currentId);
                            });
                        });
                    },
                    { rootMargin: '-45% 0px -50% 0px' }
                );

                sections.forEach((section) => {

                    spyObserver.observe(section);

                });


                /* ---------------------------------------------------------
                   8. Dashboard — Donation statistics & chart sync
                   Reads the SAME shared data source used by the Donations page
                --------------------------------------------------------- */

                const store =
                    window.SANADDonationsStore;

                if (store) {

                    // Donation count statistic
                    const dashDonations =
                        document.getElementById('dashboardDonations');

                    const stats =
                        store.computeStats();

                    if (dashDonations) {

                        dashDonations.textContent =
                            stats.total.toLocaleString('en-US') + '+';

                    }


                    // Monthly statistics chart
                    // Demo baseline bars are preserved; each added donation only
                    // increments the bar of its month by one step.
                    const chartBars =
                        document.querySelectorAll('.chart-bars .chart-bar');

                    if (chartBars.length) {

                        const chartData =
                            store.computeChartData();

                        chartBars.forEach((bar, index) => {

                            bar.style.height =
                                (chartData[index] || 0) + '%';

                        });

                    }

                }

            });
        }
    }
});