// Review overlay for the client logo row: draws every cell, its two center lines and the
// baseline of the logo, so size and centering can be judged by eye. Open the page with ?grid.
// It is plain script text, written without the less-than sign so the built page keeps it in one tag.
export const GRID_OVERLAY_SCRIPT = `
if (new URLSearchParams(location.search).has("grid")) {
  const layer = document.createElement("div");
  layer.setAttribute("data-proto-grid", "");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  document.body.append(layer);
  const box = (rect, css) => {
    const node = document.createElement("div");
    node.setAttribute("data-proto-grid", "");
    node.style.cssText = "position:absolute;box-sizing:border-box;" + css;
    node.style.left = rect.left + "px";
    node.style.top = rect.top + "px";
    node.style.width = rect.width + "px";
    node.style.height = rect.height + "px";
    layer.append(node);
  };
  const draw = () => {
    layer.replaceChildren();
    for (const cell of document.querySelectorAll(".company-wordmarks .wordmark")) {
      const cellRect = cell.getBoundingClientRect();
      const imageRect = cell.querySelector("img").getBoundingClientRect();
      box(cellRect, "outline:1px solid rgba(255,0,80,0.8);outline-offset:-1px");
      box({ left: cellRect.left + cellRect.width / 2, top: cellRect.top, width: 0, height: cellRect.height }, "border-left:1px dashed rgba(0,120,255,0.9)");
      box({ left: cellRect.left, top: cellRect.top + cellRect.height / 2, width: cellRect.width, height: 0 }, "border-top:1px dashed rgba(0,120,255,0.9)");
      box(imageRect, "outline:1px solid rgba(0,170,90,0.9);outline-offset:-1px");
      box({ left: cellRect.left, top: imageRect.bottom, width: cellRect.width, height: 0 }, "border-top:1px solid rgba(255,160,0,0.95)");
    }
  };
  let frame = 0;
  const redraw = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  };
  // The row slides in 18px on scroll, so a single measure would drift off the logos.
  for (const name of ["scroll", "resize", "load"]) addEventListener(name, redraw, { passive: true });
  redraw();
}
`;
