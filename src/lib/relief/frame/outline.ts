// src/lib/relief/frame/outline.ts
//
// Contorni condivisi da cornice, bordino, sede vetro e bassorilievo.
//
// Perche' un modulo solo: una cornice non e' un contorno, sono tre o quattro
// perimetri concentrici (esterno, cavita', bordino, sede vetro) che devono restare
// a distanza costante fra loro. Generare ogni forma "a mano" significherebbe
// riscrivere quella logica per rettangolo, cerchio, ellisse e poligono, in due
// costruttori diversi (CSG per l'export, tassellato per l'anteprima).
//
// Qui invece si genera UNA volta il contorno esterno come elenco di punti, e tutti
// gli altri si ricavano rientrando di una distanza lungo la normale. Aggiungere una
// forma nuova costa un caso in piu' in `outlinePoints`, non un generatore nuovo.

export type Pt2 = { x: number; z: number };

export type OutlineKind = "rect" | "ellipse" | "polygon";

export type OutlineSpec = {
  kind: OutlineKind;
  /** Semi-larghezza e semi-altezza dell'ingombro. */
  halfW: number;
  halfH: number;
  /** Solo per "rect": raggio degli angoli. 0 = spigoli vivi. */
  cornerRadiusMm?: number;
  /** Solo per "polygon": numero di lati (>= 3). */
  sides?: number;
  /** Rotazione del contorno in gradi. Utile per orientare un poligono. */
  rotationDeg?: number;
};

const TAU = Math.PI * 2;

/** Contorno esterno come punti in senso antiorario. `segments` e' indicativo:
 *  rettangoli e poligoni usano i vertici che servono, le curve si suddividono. */
export function outlinePoints(spec: OutlineSpec, segments: number): Pt2[] {
  const hw = Math.max(0.01, spec.halfW);
  const hh = Math.max(0.01, spec.halfH);
  const rot = ((spec.rotationDeg ?? 0) * Math.PI) / 180;
  const n = Math.max(8, Math.round(segments));
  const out: Pt2[] = [];

  const push = (x: number, z: number) => {
    if (rot === 0) { out.push({ x, z }); return; }
    const c = Math.cos(rot), s = Math.sin(rot);
    out.push({ x: x * c - z * s, z: x * s + z * c });
  };

  if (spec.kind === "ellipse") {
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU;
      push(hw * Math.cos(t), hh * Math.sin(t));
    }
    return out;
  }

  if (spec.kind === "polygon") {
    const k = Math.max(3, Math.round(spec.sides ?? 6));
    // Il poligono e' inscritto nell'ingombro: il raggio segue hw e hh, cosi' un
    // esagono in un riquadro rettangolare risulta schiacciato come ci si aspetta.
    for (let i = 0; i < k; i++) {
      // -90 gradi: un lato in basso, che e' l'orientamento che ci si aspetta da
      // una cornice appoggiata.
      const t = (i / k) * TAU - Math.PI / 2;
      push(hw * Math.cos(t), hh * Math.sin(t));
    }
    return out;
  }

  // Rettangolo, eventualmente con angoli arrotondati.
  const r = Math.max(0, Math.min(spec.cornerRadiusMm ?? 0, hw - 0.01, hh - 0.01));
  if (r <= 0.01) {
    push(+hw, -hh); push(+hw, +hh); push(-hw, +hh); push(-hw, -hh);
    return out;
  }
  const seg = Math.max(1, Math.round(n / 4));
  const angoli: Array<[number, number, number]> = [
    [+hw - r, +hh - r, 0],                 // alto destra
    [-hw + r, +hh - r, Math.PI / 2],       // alto sinistra
    [-hw + r, -hh + r, Math.PI],           // basso sinistra
    [+hw - r, -hh + r, (3 * Math.PI) / 2], // basso destra
  ];
  for (const [cx, cz, a0] of angoli) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      push(cx + r * Math.cos(a), cz + r * Math.sin(a));
    }
  }
  return out;
}

/**
 * Rientra un contorno chiuso di `d` millimetri (negativo = allarga).
 *
 * Ogni vertice si sposta lungo la propria normale, con la correzione di spigolo
 * (1/cos(θ/2)): su un rettangolo o un poligono il risultato e' ESATTO — il bordo
 * ha la stessa larghezza su tutti i lati, angoli compresi. Su una curva chiusa
 * come l'ellisse e' il vero offset, non una scalatura: scalando un'ellisse il
 * bordo risulterebbe piu' stretto alle estremita' dell'asse maggiore, dove la
 * curvatura e' piu' alta.
 *
 * I punti devono essere in senso ANTIORARIO.
 */
export function insetOutline(pts: Pt2[], d: number): Pt2[] {
  const n = pts.length;
  if (n < 3 || Math.abs(d) < 1e-9) return pts.map((p) => ({ ...p }));

  const out: Pt2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % n]!;

    // Normali interne dei due lati che si incontrano nel vertice.
    const n1 = normaleInterna(prev, cur);
    const n2 = normaleInterna(cur, next);

    let bx = n1.x + n2.x, bz = n1.z + n2.z;
    const len = Math.hypot(bx, bz);
    if (len < 1e-9) { out.push({ ...cur }); continue; }
    bx /= len; bz /= len;

    // cos(theta/2) fra bisettrice e normale di lato: su uno spigolo vivo vale
    // meno di 1 e allunga lo spostamento quanto serve a mantenere il bordo
    // costante. Limitato per non far esplodere gli angoli molto acuti.
    const cos = Math.max(0.2, bx * n1.x + bz * n1.z);
    const k = d / cos;
    out.push({ x: cur.x + bx * k, z: cur.z + bz * k });
  }
  return out;
}

/** Normale del lato a→b rivolta verso l'interno (contorno antiorario). */
function normaleInterna(a: Pt2, b: Pt2): { x: number; z: number } {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return { x: 0, z: 0 };
  // Ruotare (dx,dz) di +90 gradi da' la normale INTERNA per un contorno antiorario.
  // Con -90 si ottiene quella esterna, e il contorno si allarga invece di rientrare.
  return { x: -dz / len, z: dx / len };
}

/** Distanza dal centro al contorno nella direzione `ang`.
 *  Il bassorilievo e' costruito per angoli, il contorno per punti: serve a far
 *  combaciare i due mondi senza duplicare la matematica delle forme. */
export function raggioNellaDirezione(pts: Pt2[], ang: number): number {
  const dx = Math.cos(ang), dz = Math.sin(ang);
  let best = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    const ex = b.x - a.x, ez = b.z - a.z;
    // Intersezione fra la semiretta dal centro e il segmento a-b.
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = (a.x * ez - a.z * ex) / den;      // distanza lungo la semiretta
    const u = (a.x * dz - a.z * dx) / den;      // posizione sul segmento
    if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9 && t > best) best = t;
  }
  return best;
}

/** Area con segno (shoelace). Su un contorno antiorario e' positiva. */
export function outlineArea(pts: Pt2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

/**
 * Un rientro e' valido finche' il contorno interno resta "dentro" quello esterno.
 * Su un angolo molto acuto — un rombo schiacciato, un triangolo — rientrando troppo
 * i lati si scavalcano e il contorno si ripiega: l'area cambia segno o crolla.
 * Serve a fermare la cornice prima che produca un pezzo impossibile.
 */
export function insetValido(pts: Pt2[], d: number): boolean {
  const a0 = outlineArea(pts);
  if (Math.abs(a0) < 1e-6) return false;
  const a1 = outlineArea(insetOutline(pts, d));
  return Math.sign(a1) === Math.sign(a0) && Math.abs(a1) > Math.abs(a0) * 0.02;
}

/** Ingombro del contorno: serve per le quote e per i controlli. */
export function outlineExtent(pts: Pt2[]): { w: number; h: number } {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.z < z0) z0 = p.z; if (p.z > z1) z1 = p.z;
  }
  return { w: x1 - x0, h: z1 - z0 };
}
