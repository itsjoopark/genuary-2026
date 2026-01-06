import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  nodeCount: 3000,
  nodeMinSize: 3.5,
  nodeMaxSize: 7.0,
  edgeOpacity: 0.25,
  maxEdgesPerNode: 4,
  neighborRadius: 25,
  
  // Physics
  noiseScale: 0.003,
  noiseStrength: 0.4,
  centerAttraction: 0.00008,
  friction: 0.96,
  
  // Transition
  transitionDuration: 1.0,
  
  // Colors - light background with dark particles
  backgroundColor: 0xF0EEE9,
  edgeColor: 0x333333
};

// ============================================
// SIMPLEX NOISE IMPLEMENTATION
// ============================================

class SimplexNoise {
  constructor() {
    this.p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) this.p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.p[i], this.p[j]] = [this.p[j], this.p[i]];
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = this.p[i & 255];
  }
  
  noise3D(x, y, z) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    
    const u = this.fade(x);
    const v = this.fade(y);
    const w = this.fade(z);
    
    const A = this.perm[X] + Y;
    const AA = this.perm[A] + Z;
    const AB = this.perm[A + 1] + Z;
    const B = this.perm[X + 1] + Y;
    const BA = this.perm[B] + Z;
    const BB = this.perm[B + 1] + Z;
    
    return this.lerp(w,
      this.lerp(v,
        this.lerp(u, this.grad(this.perm[AA], x, y, z), this.grad(this.perm[BA], x - 1, y, z)),
        this.lerp(u, this.grad(this.perm[AB], x, y - 1, z), this.grad(this.perm[BB], x - 1, y - 1, z))
      ),
      this.lerp(v,
        this.lerp(u, this.grad(this.perm[AA + 1], x, y, z - 1), this.grad(this.perm[BA + 1], x - 1, y, z - 1)),
        this.lerp(u, this.grad(this.perm[AB + 1], x, y - 1, z - 1), this.grad(this.perm[BB + 1], x - 1, y - 1, z - 1))
      )
    );
  }
  
  fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  lerp(t, a, b) { return a + t * (b - a); }
  grad(hash, x, y, z) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }
}

const noise = new SimplexNoise();

// ============================================
// GLOBAL STATE
// ============================================

let scene, camera, renderer, controls;
let nodeGeometry, nodeMaterial, nodesMesh;
let edgeGeometry, edgeMaterial, edgesMesh;

let nodes = [];
let edges = [];
let textPoints = [];

let isFormed = false;
let isTransitioning = false;
let transitionProgress = 0;
let transitionDirection = 1;
let time = 0;
let width, height;

// ============================================
// TEXT POINT EXTRACTION
// ============================================

function extractTextPoints(text, targetCount) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  const scale = 2;
  canvas.width = window.innerWidth * scale;
  canvas.height = window.innerHeight * scale;
  
  const fontSize = Math.min(canvas.width * 0.07, canvas.height * 0.28);
  ctx.font = `900 ${fontSize}px Arial Black, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#000';
  
  // Center text vertically (bottom baseline means text draws above this point)
  const textY = canvas.height / 2 + fontSize * 0.4;
  
  // Measure each letter to determine boundaries
  const letters = text.split('');
  const letterBounds = [];
  const fullWidth = ctx.measureText(text).width;
  let startX = (canvas.width / 2) - (fullWidth / 2);
  
  letters.forEach((letter, i) => {
    const letterWidth = ctx.measureText(letter).width;
    letterBounds.push({
      letter,
      index: i,
      left: startX,
      right: startX + letterWidth
    });
    startX += letterWidth;
  });
  
  // Draw full text
  ctx.fillText(text, canvas.width / 2, textY);
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  
  // Collect pixels with letter assignment
  const textPixels = [];
  for (let y = 0; y < canvas.height; y += 2) {
    for (let x = 0; x < canvas.width; x += 2) {
      const i = (y * canvas.width + x) * 4;
      if (pixels[i + 3] > 128) {
        // Determine which letter this pixel belongs to
        let letterIndex = -1;
        for (let li = 0; li < letterBounds.length; li++) {
          if (x >= letterBounds[li].left && x < letterBounds[li].right) {
            letterIndex = li;
            break;
          }
        }
        // If pixel is between letters, assign to nearest
        if (letterIndex === -1) {
          let minDist = Infinity;
          for (let li = 0; li < letterBounds.length; li++) {
            const center = (letterBounds[li].left + letterBounds[li].right) / 2;
            const dist = Math.abs(x - center);
            if (dist < minDist) {
              minDist = dist;
              letterIndex = li;
            }
          }
        }
        
        textPixels.push({
          x: (x / scale) - window.innerWidth / 2,
          y: -(y / scale) + window.innerHeight / 2,
          letterIndex
        });
      }
    }
  }
  
  const points = [];
  const step = Math.max(1, Math.floor(textPixels.length / targetCount));
  
  for (let i = 0; i < textPixels.length && points.length < targetCount; i += step) {
    const idx = Math.min(i + Math.floor(Math.random() * step), textPixels.length - 1);
    const p = textPixels[idx];
    points.push({
      x: p.x + (Math.random() - 0.5) * 3,
      y: p.y + (Math.random() - 0.5) * 3,
      z: (Math.random() - 0.5) * 30,
      letterIndex: p.letterIndex
    });
  }
  
  while (points.length < targetCount && textPixels.length > 0) {
    const p = textPixels[Math.floor(Math.random() * textPixels.length)];
    points.push({
      x: p.x + (Math.random() - 0.5) * 5,
      y: p.y + (Math.random() - 0.5) * 5,
      z: (Math.random() - 0.5) * 30,
      letterIndex: p.letterIndex
    });
  }
  
  return points;
}

// ============================================
// SPATIAL HASHING FOR EDGE CONNECTIONS
// ============================================

function buildEdges(points, maxEdges, neighborRadius) {
  const edges = [];
  const cellSize = neighborRadius;
  const grid = new Map();
  
  points.forEach((p, i) => {
    const cx = Math.floor(p.x / cellSize);
    const cy = Math.floor(p.y / cellSize);
    const key = `${cx},${cy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  });
  
  const connectionCount = new Array(points.length).fill(0);
  
  points.forEach((p, i) => {
    if (connectionCount[i] >= maxEdges) return;
    
    const cx = Math.floor(p.x / cellSize);
    const cy = Math.floor(p.y / cellSize);
    
    const neighbors = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${cx + dx},${cy + dy}`;
        if (grid.has(key)) neighbors.push(...grid.get(key));
      }
    }
    
    neighbors
      // Only connect nodes within the SAME letter
      .filter(j => j !== i && connectionCount[j] < maxEdges && points[j].letterIndex === p.letterIndex)
      .map(j => ({
        index: j,
        dist: Math.hypot(points[j].x - p.x, points[j].y - p.y)
      }))
      .filter(n => n.dist < neighborRadius && n.dist > 5)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, maxEdges - connectionCount[i])
      .forEach(n => {
        if (!edges.some(e => (e[0] === i && e[1] === n.index) || (e[0] === n.index && e[1] === i))) {
          edges.push([i, n.index]);
          connectionCount[i]++;
          connectionCount[n.index]++;
        }
      });
  });
  
  // Hub connections - only within same letter
  const hubCount = Math.floor(points.length * 0.02);
  for (let h = 0; h < hubCount; h++) {
    const i = Math.floor(Math.random() * points.length);
    // Find another point in the same letter
    const sameLetter = points.filter((p, idx) => idx !== i && p.letterIndex === points[i].letterIndex);
    if (sameLetter.length > 0) {
      const jPoint = sameLetter[Math.floor(Math.random() * sameLetter.length)];
      const j = points.indexOf(jPoint);
      if (j !== -1 && !edges.some(e => (e[0] === i && e[1] === j) || (e[0] === j && e[1] === i))) {
        edges.push([i, j]);
      }
    }
  }
  
  return edges;
}

// ============================================
// NODE INITIALIZATION
// ============================================

function initNodes() {
  textPoints = extractTextPoints('GENUARY', CONFIG.nodeCount);
  
  nodes = textPoints.map((target, i) => {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const radius = 150 + Math.random() * 100;
    
    const x = Math.sin(phi) * Math.cos(theta) * radius;
    const y = Math.sin(phi) * Math.sin(theta) * radius;
    const z = Math.cos(phi) * radius;
    
    return {
      x: x,
      y: y,
      z: z,
      startX: x,
      startY: y,
      startZ: z,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2,
      vz: (Math.random() - 0.5) * 2,
      targetX: target.x,
      targetY: target.y,
      targetZ: target.z || 0,
      letterIndex: target.letterIndex,
      size: CONFIG.nodeMinSize + Math.random() * (CONFIG.nodeMaxSize - CONFIG.nodeMinSize),
      shape: Math.floor(Math.random() * 4),
      noiseOffsetX: Math.random() * 1000,
      noiseOffsetY: Math.random() * 1000,
      noiseOffsetZ: Math.random() * 1000,
      darkness: 0.1 + Math.random() * 0.25
    };
  });
  
  edges = buildEdges(textPoints, CONFIG.maxEdgesPerNode, CONFIG.neighborRadius);
}

// ============================================
// THREE.JS SETUP
// ============================================

function initThreeJS() {
  width = window.innerWidth;
  height = window.innerHeight;
  
  scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.backgroundColor);
  
  camera = new THREE.PerspectiveCamera(50, width / height, 1, 2000);
  camera.position.z = 600;
  
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);
  
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enablePan = false;
  controls.minDistance = 300;
  controls.maxDistance = 1200;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.3;
}

function createNodeMesh() {
  nodeGeometry = new THREE.BufferGeometry();
  
  const positions = new Float32Array(nodes.length * 3);
  const sizes = new Float32Array(nodes.length);
  const colors = new Float32Array(nodes.length * 3);
  const shapes = new Float32Array(nodes.length);
  
  nodes.forEach((node, i) => {
    positions[i * 3] = node.x;
    positions[i * 3 + 1] = node.y;
    positions[i * 3 + 2] = node.z;
    sizes[i] = node.size;
    shapes[i] = node.shape;
    
    const d = node.darkness;
    colors[i * 3] = d;
    colors[i * 3 + 1] = d;
    colors[i * 3 + 2] = d;
  });
  
  nodeGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  nodeGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  nodeGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  nodeGeometry.setAttribute('shape', new THREE.BufferAttribute(shapes, 1));
  
  nodeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      pixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uTime: { value: 0.0 }
    },
    vertexShader: `
      attribute float size;
      attribute vec3 color;
      attribute float shape;
      varying vec3 vColor;
      varying float vShape;
      varying float vSize;
      uniform float pixelRatio;
      
      void main() {
        vColor = color;
        vShape = shape;
        vSize = size;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * pixelRatio * (300.0 / -mvPosition.z) * 1.4;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vShape;
      varying float vSize;
      uniform float uTime;
      
      float sdCircle(vec2 p) {
        return length(p) - 0.3;
      }
      
      float sdSquare(vec2 p) {
        vec2 d = abs(p) - vec2(0.25);
        return max(d.x, d.y);
      }
      
      float sdDiamond(vec2 p) {
        p = abs(p);
        return (p.x + p.y - 0.4) * 0.707;
      }
      
      float sdTriangle(vec2 p) {
        p.y += 0.1;
        const float k = sqrt(3.0);
        p.x = abs(p.x) - 0.25;
        p.y = p.y + 0.25/k;
        if(p.x + k*p.y > 0.0) p = vec2(p.x-k*p.y,-k*p.x-p.y)/2.0;
        p.x -= clamp(p.x, -0.5, 0.0);
        return -length(p)*sign(p.y);
      }
      
      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        
        float d;
        int shape = int(vShape + 0.5);
        
        if (shape == 0) {
          d = sdCircle(p);
        } else if (shape == 1) {
          d = sdSquare(p);
        } else if (shape == 2) {
          d = sdDiamond(p);
        } else {
          d = sdTriangle(p);
        }
        
        // Subtle pulsing glow based on time
        float pulse = 0.5 + 0.5 * sin(uTime * 1.5 + vSize * 0.5);
        float glowStrength = 0.15 + pulse * 0.1;
        
        // Outer glow - soft falloff
        float glow = exp(-d * 4.0) * glowStrength;
        
        // Core shape
        float core = 1.0 - smoothstep(-0.02, 0.02, d);
        
        // Combine core and glow
        float alpha = core + glow;
        
        // Discard if too faint
        if (alpha < 0.01) discard;
        
        // Slightly lighter color for glow
        vec3 glowColor = vColor + vec3(0.1);
        vec3 finalColor = mix(glowColor, vColor, core / max(alpha, 0.001));
        
        gl_FragColor = vec4(finalColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false
  });
  
  nodesMesh = new THREE.Points(nodeGeometry, nodeMaterial);
  scene.add(nodesMesh);
}

function createEdgeMesh() {
  edgeGeometry = new THREE.BufferGeometry();
  
  const positions = new Float32Array(edges.length * 2 * 3);
  
  edges.forEach((edge, i) => {
    const nodeA = nodes[edge[0]];
    const nodeB = nodes[edge[1]];
    
    positions[i * 6] = nodeA.x;
    positions[i * 6 + 1] = nodeA.y;
    positions[i * 6 + 2] = nodeA.z;
    
    positions[i * 6 + 3] = nodeB.x;
    positions[i * 6 + 4] = nodeB.y;
    positions[i * 6 + 5] = nodeB.z;
  });
  
  edgeGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  
  edgeMaterial = new THREE.LineBasicMaterial({
    color: CONFIG.edgeColor,
    transparent: true,
    opacity: CONFIG.edgeOpacity,
    depthWrite: false
  });
  
  edgesMesh = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  edgesMesh.renderOrder = -1;
  scene.add(edgesMesh);
}

// ============================================
// EASING & LERP
// ============================================

function easeOutQuart(t) {
  return 1 - Math.pow(1 - t, 4);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// ============================================
// ANIMATION / PHYSICS
// ============================================

function updateNodes(deltaTime) {
  // Update transition progress
  if (isTransitioning) {
    transitionProgress += (deltaTime / CONFIG.transitionDuration) * transitionDirection;
    transitionProgress = Math.max(0, Math.min(1, transitionProgress));
    
    if ((transitionDirection > 0 && transitionProgress >= 1) ||
        (transitionDirection < 0 && transitionProgress <= 0)) {
      isTransitioning = false;
      isFormed = transitionDirection > 0;
    }
  }
  
  // Smooth easing - NO BOUNCE
  const easedProgress = easeOutQuart(transitionProgress);
  
  nodes.forEach((node, i) => {
    if (isTransitioning) {
      // DIRECT LERP - no spring physics, no bounce
      if (transitionDirection > 0) {
        // Forming: interpolate from start to target
        node.x = lerp(node.startX, node.targetX, easedProgress);
        node.y = lerp(node.startY, node.targetY, easedProgress);
        node.z = lerp(node.startZ, node.targetZ, easedProgress);
      } else {
        // Releasing: interpolate from target back to start
        node.x = lerp(node.targetX, node.startX, 1 - easedProgress);
        node.y = lerp(node.targetY, node.startY, 1 - easedProgress);
        node.z = lerp(node.targetZ, node.startZ, 1 - easedProgress);
      }
    } else if (isFormed) {
      // Subtle breathing when fully formed
      const breathe = Math.sin(time * 1.2 + i * 0.03) * 0.3;
      node.x = node.targetX + breathe * 0.05;
      node.y = node.targetY + breathe * 0.05;
    } else {
      // Free floating - noise-based organic movement
      const noiseX = noise.noise3D(
        node.x * CONFIG.noiseScale + node.noiseOffsetX,
        node.y * CONFIG.noiseScale,
        time * 0.3
      );
      const noiseY = noise.noise3D(
        node.x * CONFIG.noiseScale,
        node.y * CONFIG.noiseScale + node.noiseOffsetY,
        time * 0.3 + 100
      );
      const noiseZ = noise.noise3D(
        node.x * CONFIG.noiseScale + 200,
        node.z * CONFIG.noiseScale + node.noiseOffsetZ,
        time * 0.3
      );
      
      node.vx += noiseX * CONFIG.noiseStrength;
      node.vy += noiseY * CONFIG.noiseStrength;
      node.vz += noiseZ * CONFIG.noiseStrength * 0.5;
      
      const dist = Math.hypot(node.x, node.y, node.z);
      const targetDist = 180;
      const attraction = (targetDist - dist) * 0.0003;
      if (dist > 0) {
        node.vx += (node.x / dist) * attraction * dist;
        node.vy += (node.y / dist) * attraction * dist;
        node.vz += (node.z / dist) * attraction * dist;
      }
      
      node.vx *= CONFIG.friction;
      node.vy *= CONFIG.friction;
      node.vz *= CONFIG.friction;
      
      node.x += node.vx;
      node.y += node.vy;
      node.z += node.vz;
      
      // Update start positions for next transition
      node.startX = node.x;
      node.startY = node.y;
      node.startZ = node.z;
      
      const maxDist = 280;
      if (dist > maxDist) {
        const scale = maxDist / dist * 0.99;
        node.x *= scale;
        node.y *= scale;
        node.z *= scale;
        node.startX = node.x;
        node.startY = node.y;
        node.startZ = node.z;
      }
    }
  });
}

function updateGeometry() {
  const nodePositions = nodeGeometry.attributes.position.array;
  nodes.forEach((node, i) => {
    nodePositions[i * 3] = node.x;
    nodePositions[i * 3 + 1] = node.y;
    nodePositions[i * 3 + 2] = node.z;
  });
  nodeGeometry.attributes.position.needsUpdate = true;
  
  const edgePositions = edgeGeometry.attributes.position.array;
  edges.forEach((edge, i) => {
    const nodeA = nodes[edge[0]];
    const nodeB = nodes[edge[1]];
    
    edgePositions[i * 6] = nodeA.x;
    edgePositions[i * 6 + 1] = nodeA.y;
    edgePositions[i * 6 + 2] = nodeA.z;
    
    edgePositions[i * 6 + 3] = nodeB.x;
    edgePositions[i * 6 + 4] = nodeB.y;
    edgePositions[i * 6 + 5] = nodeB.z;
  });
  edgeGeometry.attributes.position.needsUpdate = true;
}

// ============================================
// INTERACTION
// ============================================

function toggleState() {
  if (isTransitioning) return;
  
  isTransitioning = true;
  transitionDirection = isFormed ? -1 : 1;
  
  // Capture current positions as start when forming
  if (transitionDirection > 0) {
    nodes.forEach(node => {
      node.startX = node.x;
      node.startY = node.y;
      node.startZ = node.z;
    });
  }
  
  const hintText = document.getElementById('hintText');
  if (hintText) {
    hintText.textContent = isFormed ? 'click to reveal' : 'click to release';
  }
}

function setupInteraction() {
  renderer.domElement.addEventListener('click', () => {
    toggleState();
  });
  
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      toggleState();
    }
  });
}

// ============================================
// RESIZE HANDLING
// ============================================

function onResize() {
  width = window.innerWidth;
  height = window.innerHeight;
  
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  
  renderer.setSize(width, height);
  
  const newTextPoints = extractTextPoints('GENUARY', CONFIG.nodeCount);
  nodes.forEach((node, i) => {
    if (newTextPoints[i]) {
      node.targetX = newTextPoints[i].x;
      node.targetY = newTextPoints[i].y;
      node.targetZ = newTextPoints[i].z || 0;
      node.letterIndex = newTextPoints[i].letterIndex;
    }
  });
  textPoints = newTextPoints;
  
  // Rebuild edges with new letter boundaries
  edges = buildEdges(textPoints, CONFIG.maxEdgesPerNode, CONFIG.neighborRadius);
  
  // Recreate edge geometry with new edge count
  scene.remove(edgesMesh);
  edgeGeometry.dispose();
  createEdgeMesh();
}

// ============================================
// MAIN LOOP
// ============================================

let lastTime = 0;

function animate(currentTime) {
  requestAnimationFrame(animate);
  
  const deltaTime = (currentTime - lastTime) / 1000;
  lastTime = currentTime;
  time += deltaTime;
  
  controls.update();
  
  updateNodes(deltaTime);
  updateGeometry();
  
  // Update glow shader time
  if (nodeMaterial) {
    nodeMaterial.uniforms.uTime.value = time;
  }
  
  renderer.render(scene, camera);
}

// ============================================
// INITIALIZATION
// ============================================

function init() {
  initThreeJS();
  initNodes();
  createEdgeMesh();
  createNodeMesh();
  setupInteraction();
  
  window.addEventListener('resize', onResize);
  
  requestAnimationFrame(animate);
}

init();
