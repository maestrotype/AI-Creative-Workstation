import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

import styles from './MeshPreview.module.css';

interface MeshPreviewProps {
  filePath: string | null;
}

async function loadRoot(filePath: string): Promise<THREE.Object3D> {
  const buffer = await window.api.readMeshFile(filePath);
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.glb') || lower.endsWith('.gltf')) {
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(buffer, '');
    return gltf.scene;
  }
  const text = new TextDecoder().decode(buffer);
  return new OBJLoader().parse(text);
}

function fitCamera(root: THREE.Object3D, camera: THREE.PerspectiveCamera, controls: OrbitControls): void {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);
  const maxDim = Math.max(size.x, size.y, size.z, 0.01);
  const dist = maxDim * 1.85;
  camera.near = maxDim / 100;
  camera.far = maxDim * 40;
  camera.position.set(dist * 0.85, dist * 0.55, dist);
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.minDistance = maxDim * 0.4;
  controls.maxDistance = maxDim * 12;
  controls.update();
}

export function MeshPreview({ filePath }: MeshPreviewProps): ReactNode {
  const { t } = useTranslation();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !filePath) return;

    let cancelled = false;
    setLoadError(null);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x12141c);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    wrap.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    scene.add(new THREE.HemisphereLight(0xf0f4ff, 0x2a2a32, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(2.4, 3.2, 1.6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x9bb8ff, 0.35);
    fill.position.set(-2, 0.4, -1.5);
    scene.add(fill);

    const grid = new THREE.GridHelper(2, 8, 0x3a3a48, 0x2a2a34);
    grid.position.y = -0.01;
    scene.add(grid);

    let frame = 0;
    const tick = () => {
      frame = window.requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    const resize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w < 2 || h < 2) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    void loadRoot(filePath)
      .then((root) => {
        if (cancelled) return;
        root.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = false;
            const geom = child.geometry;
            const hasColor = Boolean(geom.getAttribute('color'));
            const old = child.material;
            const mats = Array.isArray(old) ? old : [old];
            mats.forEach((m) => m.dispose());
            child.material = new THREE.MeshStandardMaterial({
              color: hasColor ? 0xffffff : 0xb4b8c4,
              roughness: 0.72,
              metalness: 0.04,
              vertexColors: hasColor,
              side: THREE.DoubleSide,
            });
          }
        });
        scene.add(root);
        fitCamera(root, camera, controls);
        const span = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).length();
        grid.scale.setScalar(Math.max(span * 0.7, 0.5));
        grid.position.y = new THREE.Box3().setFromObject(root).min.y;
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => m.dispose());
        }
      });
    };
  }, [filePath]);

  if (!filePath) {
    return (
      <div className={styles.empty}>
        <p>{t('threed.preview_empty')}</p>
      </div>
    );
  }

  return (
    <div className={styles.stage}>
      <div ref={wrapRef} className={styles.canvasWrap} />
      {loadError ? <p className={styles.error}>{t('threed.preview_error')}: {loadError}</p> : (
        <p className={styles.hint}>{t('threed.preview_hint')}</p>
      )}
    </div>
  );
}
