import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';

// ============================================
// Configuration
// ============================================
const CONFIG = {
  numBoids: 500,
  maxSpeed: 2,
  maxForce: 0.05,
  separationRadius: 25,
  alignmentRadius: 50,
  cohesionRadius: 50,
  separationWeight: 1.5,
  alignmentWeight: 1.0,
  cohesionWeight: 1.0,
  mouseRepelRadius: 50,  // Reduced for tighter interaction
  mouseRepelStrength: 3.0,
  boundarySize: 300,
  triangleSize: 6,
  boidColor: 0x000000,  // Black
  homeAttractionStrength: 1.2
};

// ============================================
// Global Variables
// ============================================
let scene, camera, renderer, controls, composer;
let cursorIndicator;
let boids = [];
let mousePos = new THREE.Vector3(9999, 9999, 9999); // Start off-screen to prevent early scatter
let mouseActive = false;

// Scatter state for text formation behavior
let isScattered = false;
let scatterTimer = 0;
const SCATTER_DURATION = 180; // frames (~3 seconds at 60fps)
let textPositions = []; // Home positions for "2026" text
let boidIndex = 0; // Counter for assigning positions
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

// ============================================
// Text Position Generator
// ============================================
function generateTextPositions(text, numPoints) {
  // Create offscreen canvas to render text
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 400;
  canvas.height = 100;
  
  // Draw text
  ctx.fillStyle = 'white';
  ctx.font = 'bold 80px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 200, 50);
  
  // Sample pixel positions where text exists
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const positions = [];
  
  for (let y = 0; y < canvas.height; y += 2) {
    for (let x = 0; x < canvas.width; x += 2) {
      const i = (y * canvas.width + x) * 4;
      if (imageData.data[i] > 128) {
        // Map canvas coords to 3D space, centered
        positions.push(new THREE.Vector3(
          (x - 200) * 1.5,
          (50 - y) * 1.5,
          (Math.random() - 0.5) * 30  // slight z variation
        ));
      }
    }
  }
  
  // Shuffle and select numPoints
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  
  // If we need more points than available, duplicate some
  while (positions.length < numPoints) {
    const idx = Math.floor(Math.random() * positions.length);
    const pos = positions[idx].clone();
    pos.x += (Math.random() - 0.5) * 5;
    pos.y += (Math.random() - 0.5) * 5;
    pos.z += (Math.random() - 0.5) * 10;
    positions.push(pos);
  }
  
  return positions.slice(0, numPoints);
}

// ============================================
// Boid Class
// ============================================
class Boid {
  constructor(homePos) {
    // Store home position for text formation
    this.homePosition = homePos.clone();
    
    // Initialize at home position
    this.position = homePos.clone();
    
    this.velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2
    );
    this.velocity.normalize().multiplyScalar(CONFIG.maxSpeed * 0.5);
    
    this.acceleration = new THREE.Vector3();
    
    // Interaction state flag
    this.isNearMouse = false;
    
    // Color objects for smooth lerping
    this.baseColor = new THREE.Color(CONFIG.boidColor);
    this.glowColor = new THREE.Color(0xFF4444); // Glowy red
    this.currentEmissive = new THREE.Color(CONFIG.boidColor);
    
    // Create rectangular bar mesh
    this.mesh = this.createRectangleMesh();
    scene.add(this.mesh);
  }
  
  createRectangleMesh() {
    // Thin rectangular bar - elongated in one direction
    const geometry = new THREE.BoxGeometry(
      CONFIG.triangleSize * 0.3,   // width (thin)
      CONFIG.triangleSize * 0.3,   // height (thin)
      CONFIG.triangleSize * 3      // depth (long) - points in direction of movement
    );
    
    // Material that responds to lighting with flat shading and emissive for glow
    const material = new THREE.MeshStandardMaterial({
      color: CONFIG.boidColor,
      flatShading: true,
      emissive: CONFIG.boidColor,
      emissiveIntensity: 0.1
    });
    
    return new THREE.Mesh(geometry, material);
  }
  
  applyForce(force) {
    this.acceleration.add(force);
  }
  
  // Separation: steer to avoid crowding
  separation(boids) {
    const steer = new THREE.Vector3();
    let count = 0;
    
    for (const other of boids) {
      if (other === this) continue;
      
      const d = this.position.distanceTo(other.position);
      
      if (d > 0 && d < CONFIG.separationRadius) {
        const diff = new THREE.Vector3().subVectors(this.position, other.position);
        diff.normalize();
        diff.divideScalar(d); // Weight by distance
        steer.add(diff);
        count++;
      }
    }
    
    if (count > 0) {
      steer.divideScalar(count);
      steer.normalize();
      steer.multiplyScalar(CONFIG.maxSpeed);
      steer.sub(this.velocity);
      steer.clampLength(0, CONFIG.maxForce);
    }
    
    return steer;
  }
  
  // Alignment: steer towards average heading of neighbors
  alignment(boids) {
    const avgVelocity = new THREE.Vector3();
    let count = 0;
    
    for (const other of boids) {
      if (other === this) continue;
      
      const d = this.position.distanceTo(other.position);
      
      if (d > 0 && d < CONFIG.alignmentRadius) {
        avgVelocity.add(other.velocity);
        count++;
      }
    }
    
    if (count > 0) {
      avgVelocity.divideScalar(count);
      avgVelocity.normalize();
      avgVelocity.multiplyScalar(CONFIG.maxSpeed);
      
      const steer = new THREE.Vector3().subVectors(avgVelocity, this.velocity);
      steer.clampLength(0, CONFIG.maxForce);
      return steer;
    }
    
    return new THREE.Vector3();
  }
  
  // Cohesion: steer towards center of mass of neighbors
  cohesion(boids) {
    const centerOfMass = new THREE.Vector3();
    let count = 0;
    
    for (const other of boids) {
      if (other === this) continue;
      
      const d = this.position.distanceTo(other.position);
      
      if (d > 0 && d < CONFIG.cohesionRadius) {
        centerOfMass.add(other.position);
        count++;
      }
    }
    
    if (count > 0) {
      centerOfMass.divideScalar(count);
      return this.seek(centerOfMass);
    }
    
    return new THREE.Vector3();
  }
  
  // Seek: steer towards a target position
  seek(target) {
    const desired = new THREE.Vector3().subVectors(target, this.position);
    desired.normalize();
    desired.multiplyScalar(CONFIG.maxSpeed);
    
    const steer = new THREE.Vector3().subVectors(desired, this.velocity);
    steer.clampLength(0, CONFIG.maxForce);
    return steer;
  }
  
  // Seek home position to form text shape
  seekHome() {
    return this.seek(this.homePosition).multiplyScalar(CONFIG.homeAttractionStrength);
  }
  
  // Flee from mouse position
  mouseRepel(mousePosition) {
    const d = this.position.distanceTo(mousePosition);
    
    if (d < CONFIG.mouseRepelRadius && d > 0) {
      this.isNearMouse = true; // Mark as near mouse cursor
      
      const flee = new THREE.Vector3().subVectors(this.position, mousePosition);
      flee.normalize();
      
      // Inverse square falloff for more natural feel
      const strength = CONFIG.mouseRepelStrength * (1 - d / CONFIG.mouseRepelRadius);
      flee.multiplyScalar(strength);
      flee.clampLength(0, CONFIG.maxForce * 4);
      
      return flee;
    }
    
    return new THREE.Vector3();
  }
  
  // Apply all flocking behaviors
  flock(boids, mousePosition, isMouseActive, scattered) {
    const sep = this.separation(boids).multiplyScalar(CONFIG.separationWeight);
    const ali = this.alignment(boids).multiplyScalar(CONFIG.alignmentWeight);
    const coh = this.cohesion(boids).multiplyScalar(CONFIG.cohesionWeight);
    
    if (scattered) {
      // Full flocking when scattered
      this.applyForce(sep);
      this.applyForce(ali);
      this.applyForce(coh);
    } else {
      // When forming text - no movement at all
      this.velocity.set(0, 0, 0);
      // Snap to home position smoothly
      this.position.lerp(this.homePosition, 0.1);
    }
    
    if (isMouseActive) {
      const mouseForce = this.mouseRepel(mousePosition);
      this.applyForce(mouseForce);
    }
  }
  
  // Wrap around boundaries
  wrapEdges() {
    const bound = CONFIG.boundarySize;
    
    if (this.position.x > bound) this.position.x = -bound;
    if (this.position.x < -bound) this.position.x = bound;
    if (this.position.y > bound) this.position.y = -bound;
    if (this.position.y < -bound) this.position.y = bound;
    if (this.position.z > bound) this.position.z = -bound;
    if (this.position.z < -bound) this.position.z = bound;
  }
  
  update(scattered) {
    // Update velocity
    this.velocity.add(this.acceleration);
    this.velocity.clampLength(0, CONFIG.maxSpeed);
    
    // Damping when near home position (for stable text formation)
    if (!scattered) {
      const distToHome = this.position.distanceTo(this.homePosition);
      if (distToHome < 20) {
        this.velocity.multiplyScalar(0.85); // Strong damping near home
      } else if (distToHome < 50) {
        this.velocity.multiplyScalar(0.95); // Light damping approaching home
      }
    }
    
    // Update position
    this.position.add(this.velocity);
    
    // Wrap around edges
    this.wrapEdges();
    
    // Reset acceleration
    this.acceleration.set(0, 0, 0);
    
    // Update mesh position
    this.mesh.position.copy(this.position);
    
    // Orient rectangle to face direction of movement
    if (this.velocity.lengthSq() > 0.001) {
      const lookTarget = new THREE.Vector3().addVectors(this.position, this.velocity);
      this.mesh.lookAt(lookTarget);
    }
    
    // Speed-based glow intensity
    const speed = this.velocity.length();
    const baseIntensity = THREE.MathUtils.mapLinear(speed, 0, CONFIG.maxSpeed, 0.1, 0.4);
    
    // Smooth color transition for cursor interaction
    if (this.isNearMouse) {
      // Lerp towards glowy red
      this.currentEmissive.lerp(this.glowColor, 0.15);
      this.mesh.material.emissiveIntensity = THREE.MathUtils.lerp(
        this.mesh.material.emissiveIntensity, 0.8, 0.15
      );
    } else {
      // Lerp back to base cream color
      this.currentEmissive.lerp(this.baseColor, 0.08);
      this.mesh.material.emissiveIntensity = THREE.MathUtils.lerp(
        this.mesh.material.emissiveIntensity, baseIntensity, 0.08
      );
    }
    
    this.mesh.material.emissive.copy(this.currentEmissive);
    
    // Reset flag for next frame
    this.isNearMouse = false;
  }
}

// ============================================
// Initialization
// ============================================
function init() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xF0EEE9);
  
  // Depth fog for atmospheric effect
  scene.fog = new THREE.FogExp2(0xF0EEE9, 0.003);
  
  // Camera
  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    2000
  );
  camera.position.z = 350;  // Zoomed in closer to "2026"
  
  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);
  
  // Orbit Controls for camera navigation
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  
  // Lighting
  // Ambient light for base illumination
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);
  
  // Directional light for depth/shadows
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(1, 1, 1);
  scene.add(directionalLight);
  
  // Cursor indicator - glowing red sphere
  const cursorGeometry = new THREE.SphereGeometry(15, 16, 16);
  const cursorMaterial = new THREE.MeshBasicMaterial({
    color: 0xFF4444,
    transparent: true,
    opacity: 0.3
  });
  cursorIndicator = new THREE.Mesh(cursorGeometry, cursorMaterial);
  cursorIndicator.visible = false;  // Hidden by default
  scene.add(cursorIndicator);
  
  // Post-processing for motion trails
  composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  
  const afterimagePass = new AfterimagePass();
  afterimagePass.uniforms['damp'].value = 0.8; // Lower = shorter, more subtle trails
  composer.addPass(afterimagePass);
  
  // Generate text positions for "2026"
  textPositions = generateTextPositions('2026', CONFIG.numBoids);
  
  // Create boids with assigned home positions
  for (let i = 0; i < CONFIG.numBoids; i++) {
    boids.push(new Boid(textPositions[i]));
  }
  
  // Event listeners
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseenter', () => mouseActive = true);
  window.addEventListener('mouseleave', () => mouseActive = false);
  
  // Start animation
  animate();
}

// ============================================
// Event Handlers
// ============================================
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}

function onMouseMove(event) {
  mouseActive = true;
  
  // Convert mouse to normalized device coordinates
  mouseNDC.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouseNDC.y = -(event.clientY / window.innerHeight) * 2 + 1;
  
  // Project mouse onto a plane at z=0
  raycaster.setFromCamera(mouseNDC, camera);
  raycaster.ray.intersectPlane(plane, mousePos);
}

// ============================================
// Animation Loop
// ============================================
function animate() {
  requestAnimationFrame(animate);
  
  // Check if cursor directly collides with any boid to trigger scatter
  if (mouseActive) {
    for (const boid of boids) {
      if (boid.position.distanceTo(mousePos) < 30) {  // Direct collision only
        isScattered = true;
        scatterTimer = SCATTER_DURATION;
        break;
      }
    }
  }
  
  // Manage scatter timer
  if (scatterTimer > 0) {
    scatterTimer--;
  } else {
    isScattered = false;
  }
  
  // Update all boids
  for (const boid of boids) {
    boid.flock(boids, mousePos, mouseActive, isScattered);
  }
  
  for (const boid of boids) {
    boid.update(isScattered);
  }
  
  // Update cursor indicator position and visibility
  cursorIndicator.position.copy(mousePos);
  cursorIndicator.visible = isScattered;  // Only show during interaction
  
  // Update orbit controls
  controls.update();
  
  // Render with post-processing
  composer.render();
}

// ============================================
// Start
// ============================================
init();

