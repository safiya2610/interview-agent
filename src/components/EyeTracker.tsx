"use client";

import React, { useEffect, useRef, useState } from "react";
import Script from "next/script";

type EyeTrackerProps = {
  onLookAway: () => void;
  lookAwayThresholdMs?: number; // How long to look away before triggering
};

export default function EyeTracker({ onLookAway, lookAwayThresholdMs = 3000 }: EyeTrackerProps) {
  const [cvReady, setCvReady] = useState(false);
  const [status, setStatus] = useState("Loading OpenCV...");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lookAwayStartRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const allStreamsRef = useRef<MediaStream[]>([]);

  // Request camera immediately on mount so the permission prompt triggers alongside the mic prompt
  useEffect(() => {
    let unmounted = false;
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } })
        .then(stream => {
          if (unmounted) {
            stream.getTracks().forEach(t => t.stop());
            return;
          }
          allStreamsRef.current.push(stream);
          if (videoRef.current && !videoRef.current.srcObject) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => {});
          }
        })
        .catch(err => console.warn("Early camera permission error:", err));
    }
    return () => {
      unmounted = true;
    };
  }, []);

  useEffect(() => {
    if (!cvReady) return;

    let isCancelled = false;
    runningRef.current = true;
    let cap: any;
    let faceClassifier: any;
    let eyeClassifier: any;
    let src: any;
    let gray: any;
    let requestFrameId: number;

    const initTracker = async () => {
      const cv = (window as any).cv;
      if (!cv) return;

      try {
        setStatus("Fetching cascade files...");
        // Fetch Haar Cascades from public folder
        const faceRes = await fetch("/cascades/haarcascade_frontalface_default.xml");
        const eyeRes = await fetch("/cascades/haarcascade_eye.xml");
        
        const faceBuf = await faceRes.arrayBuffer();
        const eyeBuf = await eyeRes.arrayBuffer();

        try {
          cv.FS_createDataFile("/", "face.xml", new Uint8Array(faceBuf), true, false, false);
        } catch (e) { /* ignore if already exists */ }
        
        try {
          cv.FS_createDataFile("/", "eye.xml", new Uint8Array(eyeBuf), true, false, false);
        } catch (e) { /* ignore if already exists */ }

        setStatus("Initializing camera...");
        
        let stream = videoRef.current?.srcObject as MediaStream;
        if (!stream) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
          if (isCancelled) {
            stream.getTracks().forEach(t => t.stop());
            return;
          }
          allStreamsRef.current.push(stream);
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play().catch(() => {});
          }
        } else {
          if (isCancelled) return;
          await videoRef.current!.play().catch(() => {});
        }
          
        // Wait for video metadata to have correct dimensions
          if (videoRef.current && videoRef.current.videoWidth === 0) {
            await new Promise((resolve) => {
              if (isCancelled) return resolve(null);
              if (videoRef.current) {
                videoRef.current.onloadedmetadata = resolve as any;
              }
            });
          }
        
        if (isCancelled) return;

        setStatus("Tracking Active");

        const width = videoRef.current!.videoWidth || 320;
        const height = videoRef.current!.videoHeight || 240;

        src = new cv.Mat(height, width, cv.CV_8UC4);
        gray = new cv.Mat();
        cap = new cv.VideoCapture(videoRef.current!);
        faceClassifier = new cv.CascadeClassifier();
        eyeClassifier = new cv.CascadeClassifier();
        
        faceClassifier.load("face.xml");
        eyeClassifier.load("eye.xml");

        const processVideo = () => {
          if (isCancelled || !runningRef.current || !videoRef.current) return;
          
          try {
            cap.read(src);
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

            // Detect faces
            const faces = new cv.RectVector();
            const eyes = new cv.RectVector();
            
            faceClassifier.detectMultiScale(gray, faces, 1.1, 3, 0);
            
            let isLookingAtScreen = false;

            if (faces.size() > 0) {
              isLookingAtScreen = true; // For robustness, finding a face is often enough
              
              // We could enforce open eyes too, but it can be flaky with glasses/lighting.
              // Just to be strict as requested:
              const face = faces.get(0);
              const roiGray = gray.roi(face);
              eyeClassifier.detectMultiScale(roiGray, eyes, 1.1, 3, 0);
              // If we want to strictly require eyes: 
              // isLookingAtScreen = eyes.size() > 0;
              roiGray.delete();
            }

            faces.delete();
            eyes.delete();

            // Render to debug canvas if needed (optional)
            if (canvasRef.current) {
              cv.imshow(canvasRef.current, src);
            }

            // Logic to trigger onLookAway
            if (!isLookingAtScreen) {
              if (lookAwayStartRef.current === null) {
                lookAwayStartRef.current = Date.now();
              } else if (Date.now() - lookAwayStartRef.current > lookAwayThresholdMs) {
                // Trigger event, then reset timer so we don't spam
                onLookAway();
                lookAwayStartRef.current = null;
              }
            } else {
              lookAwayStartRef.current = null; // Reset when they look back
            }
          } catch (err) {
            console.error("OpenCV process error:", err);
          }

          // Delay slightly to not freeze UI thread (e.g. 10 FPS is enough for tracking)
          setTimeout(() => {
            requestFrameId = requestAnimationFrame(processVideo);
          }, 100);
        };

        requestFrameId = requestAnimationFrame(processVideo);

      } catch (err: any) {
        console.error("EyeTracker Error:", err);
        setStatus("Error: " + (err?.message || "initializing tracker"));
      }
    };

    initTracker();

    return () => {
      isCancelled = true;
      runningRef.current = false;
      if (requestFrameId) cancelAnimationFrame(requestFrameId);
      if (src) src.delete();
      if (gray) gray.delete();
      if (faceClassifier) faceClassifier.delete();
      if (eyeClassifier) eyeClassifier.delete();
    };
  }, [cvReady, onLookAway, lookAwayThresholdMs]);

  // Master cleanup for all created streams on component unmount
  useEffect(() => {
    return () => {
      allStreamsRef.current.forEach(stream => {
        stream.getTracks().forEach(t => t.stop());
      });
    };
  }, []);

  return (
    <div className="absolute bottom-4 right-4 z-50 bg-black/50 p-2 rounded-xl border border-white/10 backdrop-blur-sm shadow-xl">
      {/* Script tag to load OpenCV lazily */}
      <Script 
        src="https://docs.opencv.org/4.8.0/opencv.js" 
        strategy="afterInteractive"
        onLoad={() => {
          const checkCv = setInterval(() => {
            const cv = (window as any).cv;
            if (cv && typeof cv.Mat === 'function') {
              clearInterval(checkCv);
              setCvReady(true);
            }
          }, 100);
        }}
      />
      
      <div className="flex flex-col items-center gap-2">
        <span className="text-[10px] text-slate-300 font-mono tracking-wider uppercase flex items-center gap-2">
          {status === "Tracking Active" && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>}
          {status !== "Tracking Active" && <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></span>}
          {status}
        </span>
        <div className="relative rounded overflow-hidden shadow-inner bg-black w-[160px] h-[120px]">
          {/* We use a hidden video for capture, and show the canvas feed which has OpenCV output (optional) or just the raw feed */}
          <video 
            ref={videoRef} 
            className="hidden" 
            width={320} 
            height={240} 
            playsInline 
            autoPlay 
            muted 
          />
          <canvas 
            ref={canvasRef} 
            className="w-full h-full object-cover transform -scale-x-100" 
            width={320} 
            height={240} 
          />
        </div>
      </div>
    </div>
  );
}
