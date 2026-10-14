// Busto 3D estático de una skin de Minecraft (cabeza, torso y brazos).
// Es una proyección en perspectiva "isométrica" hecha con canvas 2D: no usa librerías ni WebGL.
//   renderBust(canvas, { skin, cape, slim, view })
//     skin: data URL / URL del PNG de la skin
//     cape: data URL / URL de la capa (opcional; solo se ve en view "back")
//     slim: true para brazos finos (modelo Alex)
//     view: "front" (por defecto) o "back"
(() => {
  const YAW = 25;   // grados: giro para ver el frente y un costado
  const PITCH = 18; // grados: inclinación para ver la parte de arriba de la cabeza
  const SHADE = { top: 1.08, front: 0.98, right: 0.76, left: 0.76, back: 0.82 };

  const imgCache = new Map();
  function loadImage(src) {
    if (!imgCache.has(src)) {
      imgCache.set(src, new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => { imgCache.delete(src); reject(new Error("No se pudo cargar la imagen")); };
        img.src = src;
      }));
    }
    return imgCache.get(src);
  }

  // Zonas de la textura de una caja (w ancho, h alto, d fondo) cuyo origen está en (tx, ty)
  function uv(tx, ty, w, h, d) {
    return {
      right: [tx, ty + d, d, h],
      front: [tx + d, ty + d, w, h],
      left: [tx + d + w, ty + d, d, h],
      back: [tx + 2 * d + w, ty + d, w, h],
      top: [tx + d, ty, w, d],
    };
  }

  // Caras de una caja: nombre, normal hacia fuera, esquina de origen de la textura (P0) y ejes U (ancho) y V (alto)
  function faces(x0, y0, z0, w, h, d) {
    return [
      { name: "front", n: [0, 0, 1],  P0: [x0, y0 + h, z0 + d],     U: [w, 0, 0],  V: [0, -h, 0] },
      { name: "back",  n: [0, 0, -1], P0: [x0 + w, y0 + h, z0],     U: [-w, 0, 0], V: [0, -h, 0] },
      { name: "right", n: [-1, 0, 0], P0: [x0, y0 + h, z0],         U: [0, 0, d],  V: [0, -h, 0] },
      { name: "left",  n: [1, 0, 0],  P0: [x0 + w, y0 + h, z0 + d], U: [0, 0, -d], V: [0, -h, 0] },
      { name: "top",   n: [0, 1, 0],  P0: [x0, y0 + h, z0],         U: [w, 0, 0],  V: [0, 0, d] },
    ];
  }

  // Piezas del busto: [caja x0,y0,z0,w,h,d], [textura tx,ty,w,h,d], margen de la capa
  function buildParts(old, slim) {
    const aw = slim ? 3 : 4;
    const head = { c: [0, 16, 0], layers: [
      [[-4, 12, -4, 8, 8, 8], [0, 0, 8, 8, 8], 0],
      [[-4, 12, -4, 8, 8, 8], [32, 0, 8, 8, 8], 0.5],
    ] };
    const body = { c: [0, 6, 0], layers: [[[-4, 0, -2, 8, 12, 4], [16, 16, 8, 12, 4], 0]] };
    const rArm = { c: [-4 - aw / 2, 6, 0], layers: [[[-4 - aw, 0, -2, aw, 12, 4], [40, 16, aw, 12, 4], 0]] };
    const lArm = { c: [4 + aw / 2, 6, 0], flip: old, layers: [[[4, 0, -2, aw, 12, 4], old ? [40, 16, aw, 12, 4] : [32, 48, aw, 12, 4], 0]] };
    if (!old) {
      body.layers.push([[-4, 0, -2, 8, 12, 4], [16, 32, 8, 12, 4], 0.25]);
      rArm.layers.push([[-4 - aw, 0, -2, aw, 12, 4], [40, 32, aw, 12, 4], 0.25]);
      lArm.layers.push([[4, 0, -2, aw, 12, 4], [48, 48, aw, 12, 4], 0.25]);
    }
    return { head, body, rArm, lArm };
  }

  async function renderBust(canvas, opts) {
    const view = opts.view === "back" ? "back" : "front";
    const skinImg = await loadImage(opts.skin);
    const capeImg = opts.cape && view === "back" ? await loadImage(opts.cape) : null;

    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = "none";
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;

    const yaw = ((view === "front" ? 0 : 180) + YAW) * Math.PI / 180;
    const pitch = PITCH * Math.PI / 180;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);

    // proyección ortográfica 3D -> pantalla (lineal, sin traslación)
    const proj = (x, y, z) => [x * cy + z * sy, -y * cp + (-x * sy + z * cy) * sp];
    const visible = (n) => n[1] * sp + (-n[0] * sy + n[2] * cy) * cp > 1e-6;
    const depth = (c) => (-c[0] * sy + c[2] * cy) * cp + c[1] * sp;

    const old = skinImg.height === 32; // skins antiguas 64x32: sin capas de ropa y un solo brazo
    const { head, body, rArm, lArm } = buildParts(old, !!opts.slim);
    let order = [body, rArm, lArm].sort((a, b) => depth(a.c) - depth(b.c));
    order = capeImg ? [...order, { cape: true }, head] : [...order, head];

    // Encajar el busto en el lienzo
    const pts = [];
    for (const p of order) {
      if (p.cape) {
        for (const x of [-5, 5]) for (const y of [0, 12]) pts.push(proj(x, y, -3));
        continue;
      }
      for (const [b, , e] of p.layers) {
        const [x0, y0, z0, w, h, d] = b;
        for (const x of [x0 - e, x0 + w + e]) for (const y of [y0 - e, y0 + h + e]) for (const z of [z0 - e, z0 + d + e]) pts.push(proj(x, y, z));
      }
    }
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const S = Math.min(W / (maxX - minX), H / (maxY - minY)) * 0.92;
    const ox = W / 2 - ((minX + maxX) / 2) * S;
    const oy = H / 2 - ((minY + maxY) / 2) * S;

    function drawFace(img, region, P0, U, V, shade, flip) {
      const [sx, sy2, sw, sh] = region;
      if (flip) { P0 = [P0[0] + U[0], P0[1] + U[1], P0[2] + U[2]]; U = [-U[0], -U[1], -U[2]]; }
      const o = proj(...P0), u = proj(...U), v = proj(...V);
      ctx.save();
      ctx.setTransform((u[0] * S) / sw, (u[1] * S) / sw, (v[0] * S) / sh, (v[1] * S) / sh, ox + o[0] * S, oy + o[1] * S);
      ctx.filter = shade === 1 ? "none" : `brightness(${shade})`;
      ctx.drawImage(img, sx, sy2, sw, sh, 0, 0, sw, sh);
      ctx.restore();
    }

    for (const p of order) {
      if (p.cape) {
        // cara exterior de la capa (zona 1,1 de 10x16 en la textura); el busto la corta a 12 de alto
        drawFace(capeImg, [1, 1, 10, 12], [5, 12, -3], [-10, 0, 0], [0, -12, 0], SHADE.back, false);
        continue;
      }
      for (const [b, t, e] of p.layers) {
        const [x0, y0, z0, w, h, d] = b;
        const regions = uv(...t);
        for (const f of faces(x0 - e, y0 - e, z0 - e, w + 2 * e, h + 2 * e, d + 2 * e)) {
          if (visible(f.n)) drawFace(skinImg, regions[f.name], f.P0, f.U, f.V, SHADE[f.name], !!p.flip);
        }
      }
    }
  }

  window.renderBust = renderBust;
})();
