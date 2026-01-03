import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============================================
// Configuration
// ============================================
const CONFIG = {
  backgroundColor: 0xF0EEE9,
  textColor: '#000000',
  cameraZ: 400,
  // Boids-like movement parameters
  wanderStrength: 0.02,
  centerAttraction: 0.008,
  maxSpeed: 1.2,
  boundaryRadius: 100,
  rotationSpeed: 0.15,
  // Spiral transition parameters
  transitionSpeed: 0.04,  // Lerp speed for smooth animation
  spiralScale: 6          // Overall size of the spiral (centered fit)
};

// All 10 Rules - word arrays for each rule
const RULES = {
  1: ["Find", "a", "place", "you", "trust,", "and", "then", "try", "trusting", "it", "for", "awhile."],
  2: ["General", "duties", "as", "a", "student", "-", "pull", "everything", "out", "of", "your", "teacher;", "pull", "everything", "out", "of", "your", "fellow", "students."],
  3: ["General", "duties", "as", "a", "teacher", "-", "pull", "everything", "out", "of", "your", "students."],
  4: ["Consider", "everything", "an", "experiment."],
  5: ["Be", "Self", "Disciplined", "-", "this", "means", "finding", "someone", "wise", "or", "smart", "and", "choosing", "to", "follow", "them.", "To", "be", "disciplined", "is", "to", "follow", "in", "a", "good", "way.", "To", "be", "self-disciplined", "is", "to", "follow", "in", "a", "better", "way."],
  6: ["Nothing", "is", "a", "mistake.", "There", "is", "no", "win", "and", "no", "fail.", "There", "is", "only", "make."],
  7: ["The", "only", "rule", "is", "work.", "If", "you", "work", "it", "will", "lead", "to", "something.", "It", "is", "the", "people", "who", "do", "all", "the", "work", "all", "the", "time", "who", "eventually", "catch", "onto", "things."],
  8: ["Do", "not", "try", "to", "create", "and", "analyze", "at", "the", "same", "time.", "They're", "different", "processes."],
  9: ["Be", "happy", "whenever", "you", "can", "manage", "it.", "Enjoy", "yourself.", "It", "is", "lighter", "than", "you", "think."],
  10: ["We", "are", "breaking", "all", "the", "rules,", "even", "our", "own", "rules", "and", "how", "do", "we", "do", "that?", "By", "leaving", "plenty", "of", "room", "for", "X", "qualities."]
};

// Current rule and words
let currentRule = 1;
let WORDS = RULES[currentRule];

// ============================================
// Global Variables
// ============================================
let scene, camera, renderer, controls;
let wordMeshes = [];
let wordData = []; // Store position, velocity, and animation data

// Spiral state
let isSpiral = false;
let spiralPositions = [];  // Pre-calculated target positions
let spiralRotations = [];  // Pre-calculated target rotations
let isTransitioning = false;

const clock = new THREE.Clock();

// ============================================
// Initialization
// ============================================
function init() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.backgroundColor);
  
  // Camera
  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    2000
  );
  camera.position.z = CONFIG.cameraZ;
  
  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);
  
  // Orbit Controls - allows user to rotate and zoom
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enableZoom = true;
  controls.minDistance = 50;
  controls.maxDistance = 800;
  controls.enablePan = true;
  
  // Create floating words
  createFloatingWords();
  
  // Calculate spiral positions
  calculateSpiralPositions();
  
  // Event listeners
  window.addEventListener('resize', onWindowResize);
  renderer.domElement.addEventListener('click', onCanvasClick);
  
  // Setup menu interaction
  setupMenuInteraction();
  
  // Start animation
  animate();
}

// ============================================
// Create Text Texture from Canvas
// ============================================
function createTextTexture(text, fontSize = 48) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // Set font to measure text
  ctx.font = `${fontSize}px Arial, sans-serif`;
  const metrics = ctx.measureText(text);
  
  // Size canvas to fit text with padding
  const padding = 20;
  canvas.width = Math.ceil(metrics.width) + padding * 2;
  canvas.height = fontSize + padding * 2;
  
  // Clear with transparent background
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Draw text
  ctx.font = `${fontSize}px Arial, sans-serif`;
  ctx.fillStyle = CONFIG.textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  
  return {
    texture,
    width: canvas.width,
    height: canvas.height
  };
}

// ============================================
// Calculate Fibonacci Spiral Positions
// ============================================
function calculateSpiralPositions() {
  const phi = 1.618033988749; // Golden ratio
  const b = Math.log(phi) / (Math.PI / 2); // Growth rate
  const a = CONFIG.spiralScale; // Starting radius
  
  // Start from center, spiral outward
  let theta = 4.0; // Start angle (further out to avoid inner overlap)
  const thetaIncrement = 0.48; // Angle between words (more spacing)
  
  WORDS.forEach((word, i) => {
    // Fibonacci spiral formula: r = a * e^(b * theta)
    const r = a * Math.exp(b * theta);
    
    // Convert polar to cartesian
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    
    // Rotation: tangent to spiral (perpendicular to radius)
    let rotation = theta + Math.PI / 2;
    
    // Normalize to [-π, π] for easier upside-down detection
    while (rotation > Math.PI) rotation -= Math.PI * 2;
    while (rotation < -Math.PI) rotation += Math.PI * 2;
    
    // Flip upside-down text to be readable
    // Text is readable when rotation is roughly horizontal (-90° to +90°)
    // If rotation points "down" (angle > 90° or < -90°), flip it
    if (Math.abs(rotation) > Math.PI / 2) {
      rotation += Math.PI;
      // Re-normalize after flip
      while (rotation > Math.PI) rotation -= Math.PI * 2;
      while (rotation < -Math.PI) rotation += Math.PI * 2;
    }
    
    spiralPositions[i] = new THREE.Vector3(x, y, 0);
    spiralRotations[i] = rotation;
    
    // Increment theta for next word
    // Adjust based on word length for better spacing
    const wordLength = word.length;
    theta += thetaIncrement + (wordLength * 0.03);
  });
}

// ============================================
// Create Floating Words
// ============================================
function createFloatingWords() {
  const totalWords = WORDS.length;
  
  WORDS.forEach((word, index) => {
    // Create texture from canvas
    const { texture, width, height } = createTextTexture(word, 64);
    
    // Create material with the texture
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    
    // Create plane geometry sized to match text
    const scale = 0.15;
    const geometry = new THREE.PlaneGeometry(width * scale, height * scale);
    
    const mesh = new THREE.Mesh(geometry, material);
    
    // Start positions - scattered around center
    const angle = (index / totalWords) * Math.PI * 2;
    const radius = 30 + Math.random() * 60;
    
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const z = (Math.random() - 0.5) * 40;
    
    mesh.position.set(x, y, z);
    
    // Random initial rotation
    mesh.rotation.z = Math.random() * Math.PI * 2;
    
    scene.add(mesh);
    wordMeshes.push(mesh);
    
    // Store boids-like movement data
    const randomAngle = Math.random() * Math.PI * 2;
    const initialSpeed = 0.3 + Math.random() * 0.5;
    
    wordData.push({
      velocity: new THREE.Vector3(
        Math.cos(randomAngle) * initialSpeed,
        Math.sin(randomAngle) * initialSpeed,
        (Math.random() - 0.5) * 0.2
      ),
      rotationVelocity: (Math.random() - 0.5) * 0.01,
      targetRotation: mesh.rotation.z
    });
  });
}

// ============================================
// Canvas Click Handler - Toggle Spiral
// ============================================
function onCanvasClick(event) {
  // Ignore if it was a drag (orbit controls)
  if (controls.enabled && event.detail > 0) {
    isSpiral = !isSpiral;
    isTransitioning = true;
  }
}

// ============================================
// Animation Loop
// ============================================
function animate() {
  requestAnimationFrame(animate);
  
  const delta = clock.getDelta();
  
  if (isSpiral) {
    updateWordsSpiral(delta);
  } else {
    updateWordsWander(delta);
  }
  
  controls.update();
  renderer.render(scene, camera);
}

// ============================================
// Update Words - Spiral Mode (lerp to positions)
// ============================================
function updateWordsSpiral(delta) {
  let allSettled = true;
  
  wordMeshes.forEach((mesh, index) => {
    const targetPos = spiralPositions[index];
    const targetRot = spiralRotations[index];
    
    // Lerp position toward target
    mesh.position.x += (targetPos.x - mesh.position.x) * CONFIG.transitionSpeed;
    mesh.position.y += (targetPos.y - mesh.position.y) * CONFIG.transitionSpeed;
    mesh.position.z += (targetPos.z - mesh.position.z) * CONFIG.transitionSpeed;
    
    // Lerp rotation toward target (handling angle wrapping)
    let rotDiff = targetRot - mesh.rotation.z;
    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
    mesh.rotation.z += rotDiff * CONFIG.transitionSpeed;
    
    // Check if still moving significantly
    const dist = mesh.position.distanceTo(targetPos);
    if (dist > 0.5) allSettled = false;
  });
  
  if (allSettled) {
    isTransitioning = false;
  }
}

// ============================================
// Update Words - Wander Mode (boids-like)
// ============================================
function updateWordsWander(delta) {
  wordMeshes.forEach((mesh, index) => {
    const data = wordData[index];
    if (!data) return;
    
    // 1. Apply wander force (random steering)
    applyWander(data);
    
    // 2. Apply center attraction if too far from center
    applyCenterAttraction(mesh, data);
    
    // 3. Limit speed
    limitSpeed(data);
    
    // 4. Update position
    mesh.position.add(data.velocity);
    
    // 5. Update rotation - face direction of movement with wobble
    updateRotation(mesh, data);
  });
}

// ============================================
// Wander Behavior - Random Steering
// ============================================
function applyWander(data) {
  const wanderForce = new THREE.Vector3(
    (Math.random() - 0.5) * CONFIG.wanderStrength,
    (Math.random() - 0.5) * CONFIG.wanderStrength,
    (Math.random() - 0.5) * CONFIG.wanderStrength * 0.3
  );
  
  data.velocity.add(wanderForce);
}

// ============================================
// Center Attraction - Keep words near center
// ============================================
function applyCenterAttraction(mesh, data) {
  const distanceFromCenter = mesh.position.length();
  
  if (distanceFromCenter > CONFIG.boundaryRadius) {
    const toCenter = new THREE.Vector3()
      .copy(mesh.position)
      .negate()
      .normalize();
    
    const strength = CONFIG.centerAttraction * 
      (distanceFromCenter - CONFIG.boundaryRadius) / CONFIG.boundaryRadius;
    
    toCenter.multiplyScalar(strength);
    data.velocity.add(toCenter);
  }
}

// ============================================
// Limit Speed
// ============================================
function limitSpeed(data) {
  const speed = data.velocity.length();
  
  if (speed > CONFIG.maxSpeed) {
    data.velocity.normalize().multiplyScalar(CONFIG.maxSpeed);
  }
  
  if (speed < 0.1) {
    data.velocity.normalize().multiplyScalar(0.1);
  }
}

// ============================================
// Update Rotation - Subtle wobble
// ============================================
function updateRotation(mesh, data) {
  const targetAngle = Math.atan2(data.velocity.y, data.velocity.x) - Math.PI / 2;
  
  let angleDiff = targetAngle - mesh.rotation.z;
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
  
  mesh.rotation.z += angleDiff * CONFIG.rotationSpeed;
  
  data.rotationVelocity += (Math.random() - 0.5) * 0.002;
  data.rotationVelocity *= 0.95;
  mesh.rotation.z += data.rotationVelocity;
}

// ============================================
// Event Handlers
// ============================================
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ============================================
// Menu Interaction
// ============================================
function setupMenuInteraction() {
  const menuItems = document.querySelectorAll('.menu-item');
  
  menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation(); // Don't trigger spiral toggle
      
      // Update active state
      menuItems.forEach(m => m.classList.remove('active'));
      item.classList.add('active');
      
      // Get rule number and update content
      const ruleNum = parseInt(item.dataset.rule);
      if (ruleNum !== currentRule) {
        switchRule(ruleNum);
      }
    });
  });
}

function switchRule(ruleNum) {
  currentRule = ruleNum;
  
  // Remove old word meshes from scene
  wordMeshes.forEach(mesh => {
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    if (mesh.material.map) {
      mesh.material.map.dispose();
    }
  });
  
  // Clear arrays
  wordMeshes = [];
  wordData = [];
  spiralPositions = [];
  spiralRotations = [];
  
  // Update WORDS with new rule content
  WORDS = RULES[ruleNum];
  
  // Reset to wandering mode
  isSpiral = false;
  
  // Recreate words and spiral positions
  createFloatingWords();
  calculateSpiralPositions();
}

// ============================================
// Start
// ============================================
init();
