"use client";

import { useState, useRef, useEffect } from "react";

export default function Home() {
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [rotation, setRotation] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setUploadedImage(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePlusClick = () => {
    fileInputRef.current?.click();
  };

  // Load default mountain image on mount
  useEffect(() => {
    setUploadedImage("/mountain.jpg");
  }, []);

  // Track scroll position
  useEffect(() => {
    const handleScroll = () => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const currentScroll = window.scrollY;
      const progress = Math.min(currentScroll / maxScroll, 1);
      setScrollProgress(progress);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Apply point cloud effect
  useEffect(() => {
    if (!uploadedImage || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.src = uploadedImage;
    imageRef.current = img;

    img.onload = () => {
      canvas.width = 800;
      canvas.height = 800;
      applyPointCloud(ctx, img, scrollProgress);
    };
  }, [uploadedImage]);

  useEffect(() => {
    if (!canvasRef.current || !imageRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx || !imageRef.current.complete) return;

    applyPointCloud(ctx, imageRef.current, scrollProgress);
  }, [scrollProgress, rotation]);

  // Mouse interaction handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMouseDown = (e: MouseEvent) => {
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const deltaX = e.clientX - dragStart.x;
        const deltaY = e.clientY - dragStart.y;

        setRotation((prev) => ({
          x: prev.x + deltaY * 0.01,
          y: prev.y + deltaX * 0.01,
        }));

        setDragStart({ x: e.clientX, y: e.clientY });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    const handleMouseLeave = () => {
      setIsDragging(false);
    };

    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [isDragging, dragStart]);

  const applyPointCloud = (
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    progress: number
  ) => {
    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Image size and offset to center it
    const imageSize = 400;
    const offsetX = (canvas.width - imageSize) / 2;
    const offsetY = (canvas.height - imageSize) / 2;

    // If no scroll, just show the image centered
    if (progress === 0) {
      ctx.drawImage(img, offsetX, offsetY, imageSize, imageSize);
      return;
    }

    // Create a temporary canvas to get pixel data
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = imageSize;
    tempCanvas.height = imageSize;
    const tempCtx = tempCanvas.getContext("2d");
    if (!tempCtx) return;

    tempCtx.drawImage(img, 0, 0, imageSize, imageSize);
    const imageData = tempCtx.getImageData(0, 0, imageSize, imageSize);
    const data = imageData.data;

    // Sample points (every 3rd pixel for performance)
    const pointStep = 3;
    const points: Array<{
      x: number;
      y: number;
      z: number;
      r: number;
      g: number;
      b: number;
    }> = [];

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    for (let y = 0; y < imageSize; y += pointStep) {
      for (let x = 0; x < imageSize; x += pointStep) {
        const idx = (y * imageSize + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // Calculate brightness for Z-depth
        const brightness = (r + g + b) / 3 / 255;

        // Z position based on brightness and scroll progress
        let z = brightness * progress * 200;

        // Apply rotation - convert to centered coordinates
        // Add offset to position in canvas center
        let px = (x + offsetX) - centerX;
        let py = (y + offsetY) - centerY;
        let pz = z;

        // Rotate around Y axis
        const cosY = Math.cos(rotation.y);
        const sinY = Math.sin(rotation.y);
        const tempX = px * cosY - pz * sinY;
        pz = px * sinY + pz * cosY;
        px = tempX;

        // Rotate around X axis
        const cosX = Math.cos(rotation.x);
        const sinX = Math.sin(rotation.x);
        const tempY = py * cosX - pz * sinX;
        pz = py * sinX + pz * cosX;
        py = tempY;

        // Convert back
        const finalX = px + centerX;
        const finalY = py + centerY;

        points.push({ x: finalX, y: finalY, z: pz, r, g, b });
      }
    }

    // Sort points by Z (back to front for proper rendering)
    points.sort((a, b) => a.z - b.z);

    // Render points as circles
    const fov = 400;

    points.forEach((point) => {
      // 3D to 2D projection with perspective
      const scale = fov / (fov + point.z);
      const x2d = (point.x - centerX) * scale + centerX;
      const y2d = (point.y - centerY) * scale + centerY;

      // Point size based on depth
      const size = Math.max(1, 2 * scale);

      // Draw point
      ctx.fillStyle = `rgb(${point.r}, ${point.g}, ${point.b})`;
      ctx.beginPath();
      ctx.arc(x2d, y2d, size, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  return (
    <div className="relative bg-[#e8e5de]" style={{ minHeight: "300vh" }}>
      {/* Main Content */}
      <main className="sticky top-0 flex min-h-screen flex-col items-center justify-center">
        {/* Image Container */}
        <div className="relative w-[800px] h-[800px]">
          <canvas
            ref={canvasRef}
            className="w-full h-full cursor-grab active:cursor-grabbing"
            width={800}
            height={800}
          />
        </div>

        {/* Hidden File Input */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileUpload}
          accept="image/*"
          className="hidden"
        />

        {/* Plus Button - Bottom Right */}
        <button
          onClick={handlePlusClick}
          className="fixed bottom-8 right-8 w-12 h-12 rounded-lg border border-gray-400 flex items-center justify-center hover:bg-gray-200 transition-colors bg-[#e8e5de] shadow-md"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M10 4V16M4 10H16"
              stroke="#666"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </main>
    </div>
  );
}
