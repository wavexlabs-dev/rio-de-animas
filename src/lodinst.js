// Two-level instanced LOD: instances near the camera use the detailed mesh, the rest the light one.
import * as THREE from 'three';

export class LodInstances {
  // items: [{ m: Matrix4, p: Vector3, r: radius }]
  constructor(world, geos, mat, items, o = {}) {
    this.items = items;
    this.near = o.near || 40;
    this.far = o.far || 1e9;
    this.meshes = geos.map((g, i) => {
      const im = new THREE.InstancedMesh(g, mat, Math.max(1, items.length));
      im.count = 0;
      im.castShadow = o.cast !== false && (i === 0 || o.castFar !== false); im.receiveShadow = true;
      im.name = (o.name || 'lod') + i;
      if (o.layer !== undefined) im.layers.set(o.layer);
      world.scene.add(im);
      return im;
    });
    this.last = new THREE.Vector3(1e9, 0, 0);
    this.timer = 0;
    world.updaters.push((dt) => this.update(world.cam.position, dt));
    this.update(world.cam.position, 1);
  }
  update(cp, dt) {
    this.timer -= dt;
    if (this.timer > 0 && cp.distanceToSquared(this.last) < 9) return;
    this.timer = 0.6;
    this.last.copy(cp);
    const [m0, m1] = this.meshes;
    let c0 = 0, c1 = 0;
    const n2 = this.near * this.near;
    for (const it of this.items) {
      const d2 = it.p.distanceToSquared(cp);
      const nr = this.near + it.r * 2;
      if (d2 < nr * nr || (d2 < n2 && !m1)) m0.setMatrixAt(c0++, it.m);
      else if (m1 && d2 < (this.far + it.r * 30) ** 2) m1.setMatrixAt(c1++, it.m);
    }
    m0.count = c0; m0.instanceMatrix.needsUpdate = true; m0.computeBoundingSphere();
    if (m1) { m1.count = c1; m1.instanceMatrix.needsUpdate = true; m1.computeBoundingSphere(); }
  }
}
