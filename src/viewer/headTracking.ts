// Webcam head tracking: lean left/right/up/down to swing the view, lean in to
// zoom. From the Walker Buildings configurator.
//
// MediaPipe Face Mesh is several megabytes of WASM and model, so nothing loads
// until someone switches tracking on. Only the nose tip landmark is used.

const FACE_MESH = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619';

/** Offsets from the neutral head position, in radians and feet. */
export interface HeadOffset {
  theta: number;
  phi: number;
  zoom: number;
}

interface FaceMeshResults {
  multiFaceLandmarks?: { x: number; y: number; z: number }[][];
}
interface FaceMeshInstance {
  setOptions(o: Record<string, unknown>): void;
  onResults(cb: (r: FaceMeshResults) => void): void;
  initialize(): Promise<void>;
  send(input: { image: HTMLVideoElement }): Promise<void>;
  close?(): Promise<void>;
}
type FaceMeshCtor = new (cfg: { locateFile: (f: string) => string }) => FaceMeshInstance;

let loading: Promise<FaceMeshCtor> | null = null;

function loadFaceMesh(): Promise<FaceMeshCtor> {
  const w = window as unknown as { FaceMesh?: FaceMeshCtor };
  if (w.FaceMesh) return Promise.resolve(w.FaceMesh);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${FACE_MESH}/face_mesh.js`;
    s.crossOrigin = 'anonymous';
    s.onload = () => (w.FaceMesh ? resolve(w.FaceMesh) : reject(new Error('Face Mesh did not load')));
    s.onerror = () => {
      loading = null;
      reject(new Error('Could not reach the face tracking library'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

// Full-scale response at 100% sensitivity; the slider scales these.
const SMOOTH = 0.25;
const SCALE_X = 4.4;
const SCALE_Y = 3.2;
const SCALE_Z = 800;

/**
 * Start tracking. Writes into `out` on every processed frame and returns a
 * function that stops the camera and frees the model. `sensitivity` is read
 * live, 0.1–1.
 */
export async function startHeadTracking(
  out: HeadOffset,
  sensitivity: () => number,
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 320, height: 240, facingMode: 'user' },
  });
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.srcObject = stream;
  await video.play();

  const FaceMesh = await loadFaceMesh();
  const mesh = new FaceMesh({ locateFile: (f) => `${FACE_MESH}/${f}` });
  mesh.setOptions({ maxNumFaces: 1, refineLandmarks: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

  let sx = 0.5;
  let sy = 0.5;
  let sz = 0;
  let zBase: number | null = null;
  mesh.onResults((r) => {
    const nose = r.multiFaceLandmarks?.[0]?.[4];
    if (!nose) return;
    sx += (nose.x - sx) * SMOOTH;
    sy += (nose.y - sy) * SMOOTH;
    sz += (nose.z - sz) * SMOOTH;
    if (zBase === null) zBase = sz;
    const k = sensitivity() * 2;
    out.theta = (sx - 0.5) * SCALE_X * k;
    out.phi = (sy - 0.5) * SCALE_Y * k;
    // Head closer (z more negative) zooms in.
    out.zoom = (sz - zBase) * SCALE_Z * k;
  });
  await mesh.initialize();

  // Feed frames by hand; MediaPipe's own Camera helper would open the webcam a
  // second time.
  let running = true;
  let busy = false;
  let raf = 0;
  const pump = async () => {
    if (!running) return;
    if (video.readyState >= 2 && !busy) {
      busy = true;
      try {
        await mesh.send({ image: video });
      } finally {
        busy = false;
      }
    }
    raf = requestAnimationFrame(pump);
  };
  raf = requestAnimationFrame(pump);

  return () => {
    running = false;
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    out.theta = 0;
    out.phi = 0;
    out.zoom = 0;
    void mesh.close?.();
  };
}
