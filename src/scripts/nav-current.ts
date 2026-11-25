// Marks the nav link of the section being read. Without it the nav is plain anchors.
const home: HTMLElement | null = document.querySelector("#home");

if (home) {
  const links: HTMLAnchorElement[] = [...document.querySelectorAll<HTMLAnchorElement>(".site-nav a")];
  const sections: (Element | null)[] = links.map((link) => document.querySelector(link.hash));
  const header = document.querySelector(".site-header") as HTMLElement;
  let updatePending = false;

  const update = (): void => {
    updatePending = false;
    let current = -1;
    const threshold = header.getBoundingClientRect().bottom + Math.min(180, innerHeight * 0.25);
    sections.forEach((section, index) => {
      const rectangle = section?.getBoundingClientRect();
      if (rectangle && rectangle.top <= threshold && rectangle.bottom > threshold) current = index;
    });
    if (scrollY + innerHeight >= document.documentElement.scrollHeight - 3) current = links.length - 1;
    links.forEach((link, index) => {
      if (index === current) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  };

  const schedule = (): void => {
    if (updatePending) return;
    updatePending = true;
    requestAnimationFrame(update);
  };

  for (const type of ["scroll", "resize", "hashchange", "pageshow"]) window.addEventListener(type, schedule, { passive: true });
  schedule();
}
