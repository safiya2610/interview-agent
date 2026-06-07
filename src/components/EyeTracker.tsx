"use client";

import React, { useEffect, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

type EyeTrackerProps = {
  onLookAway: () => void;
  lookAwayThresholdMs?: number; // How long to look away before triggering
};

export default function EyeTracker({ onLookAway, lookAwayThresholdMs = 3000 }: EyeTrackerProps) {
  const [status, setStatus] = useState("Initializing camera...");
  const videoRef = useRef<HTMLVideoElement>(null);
  const lookAwayStartRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const allStreamsRef = useRef<MediaStream[]>([]);

  // Request camera on mount
  useEffect(() => {
    let unmounted = false;
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      setStatus("Initializing camera...");
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
        .catch(err => {
          console.warn("Early camera permission error:", err);
          setStatus("Camera permission denied");
        });
    }
    return () => {
      unmounted = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;
    runningRef.current = true;
    let faceLandmarker: FaceLandmarker | null = null;
    let requestFrameId: number;

    const initTracker = async () => {
      try {
        setStatus("Loading ML Model...");
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        
        if (isCancelled) return;

        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
            delegate: "GPU"
          },
          outputFaceBlendshapes: true,
          runningMode: "VIDEO",
          numFaces: 1
        });

        if (isCancelled) return;

        setStatus("Tracking Active");

        let lastVideoTime = -1;
        let isLookingAtScreen = true; // Persist state across frames

        const processVideo = () => {
          if (isCancelled || !runningRef.current || !videoRef.current || !faceLandmarker) return;
          
          try {
            const video = videoRef.current;

            if (video.readyState >= 2 && lastVideoTime !== video.currentTime) {
                lastVideoTime = video.currentTime;
                const startTimeMs = performance.now();
                const result = faceLandmarker.detectForVideo(video, startTimeMs);
                
                isLookingAtScreen = false;

                if (result.faceLandmarks && result.faceLandmarks.length > 0) {
                  const landmarks = result.faceLandmarks[0];
                  
                  // Nose tip (1), Left edge (234), Right edge (454)
                  const nose = landmarks[1];
                  const left = landmarks[234];
                  const right = landmarks[454];

                  const distLeft = Math.abs(nose.x - left.x);
                  const distRight = Math.abs(nose.x - right.x);
                  const yawRatio = distLeft / (distLeft + distRight);

                  // Top of face (10), Bottom of face (152)
                  const top = landmarks[10];
                  const bottom = landmarks[152];
                  const distTop = Math.abs(nose.y - top.y);
                  const distBottom = Math.abs(nose.y - bottom.y);
                  const pitchRatio = distTop / (distTop + distBottom);

                  let isEyeLookingAway = false;
                  if (result.faceBlendshapes && result.faceBlendshapes.length > 0) {
                    const shapes = result.faceBlendshapes[0].categories;
                    const getScore = (name: string) => shapes.find(s => s.categoryName === name)?.score || 0;
                    
                    const maxEyeLook = Math.max(
                      getScore("eyeLookOutLeft"), getScore("eyeLookInLeft"),
                      getScore("eyeLookOutRight"), getScore("eyeLookInRight")
                    );
                    
                    if (maxEyeLook > 0.65) {
                      isEyeLookingAway = true;
                    }
                  }

                  // 0.5 is perfectly straight.
                  // Looking away threshold: > 0.75 or < 0.25 is a strong head turn.
                  const isHeadTurned = yawRatio < 0.25 || yawRatio > 0.75 || pitchRatio < 0.25 || pitchRatio > 0.75;

                  if (!isHeadTurned && !isEyeLookingAway) {
                    isLookingAtScreen = true;
                  }
                }
            }

            // Logic to trigger onLookAway
            if (!isLookingAtScreen && video.readyState >= 2) {
              if (lookAwayStartRef.current === null) {
                lookAwayStartRef.current = Date.now();
              } else if (Date.now() - lookAwayStartRef.current > lookAwayThresholdMs) {
                onLookAway();
                lookAwayStartRef.current = null;
              }
            } else {
              lookAwayStartRef.current = null; // Reset when they look back
            }
          } catch (err) {
            console.error("Tracker process error:", err);
          }

          requestFrameId = requestAnimationFrame(processVideo);
        };

        requestFrameId = requestAnimationFrame(processVideo);

      } catch (err: any) {
        console.error("EyeTracker Error:", err);
        setStatus("Error: " + (err?.message || "initializing tracker"));
      }
    };

    // Wait until video has dimensions
    const checkVideo = setInterval(() => {
      if (videoRef.current && videoRef.current.videoWidth > 0) {
        clearInterval(checkVideo);
        initTracker();
      }
    }, 100);

    return () => {
      isCancelled = true;
      runningRef.current = false;
      clearInterval(checkVideo);
      if (requestFrameId) cancelAnimationFrame(requestFrameId);
      if (faceLandmarker) faceLandmarker.close();
    };
  }, [onLookAway, lookAwayThresholdMs]);

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
      <div className="flex flex-col items-center gap-2">
        <span className="text-[10px] text-slate-300 font-mono tracking-wider uppercase flex items-center gap-2">
          {status === "Tracking Active" && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>}
          {status !== "Tracking Active" && <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></span>}
          {status}
        </span>
        <div className="relative rounded overflow-hidden shadow-inner bg-black w-[160px] h-[120px]">
          <video 
            ref={videoRef} 
            className="w-full h-full object-cover transform -scale-x-100" 
            width={320} 
            height={240} 
            playsInline 
            autoPlay 
            muted 
          />
        </div>
      </div>
    </div>
  );
}
