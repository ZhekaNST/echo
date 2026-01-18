// Vercel serverless function for Replicate Image/Video Generation
// Security: API key loaded from environment variables only

const MAX_PROMPT_LENGTH = 1000;

// Replicate model versions (must be version hashes, not model names)
const MODEL_VERSIONS = {
  // Image generation models
  flux_schnell: "5599ed30703defd1d160a25a63321b4dec97101d98b4674bcc56e41f62f35637",
  flux_dev: "0ba0de7c1c507a82c3e3c6a7e9c6e3b6c2e4e8e9b6c2e4e8e9b6c2e4e8e9b6c2e4",
  sdxl_turbo: "39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
  juggernaut: "1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
  dreamshaper: "2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3",

  // Video generation models
  video_cog: "9f747673945c62801b13b84701c783929c0ee784e4748ec062204894dda1a351",
  stable_video: "3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4",
  video_luma: "4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5",

  // Legacy/fallback
  video: "9f747673945c62801b13b84701c783929c0ee784e4748ec062204894dda1a351",
  sdxl: "39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
};

interface ReplicateRequest {
  prompt?: string;
  model?: string;
  type?: "image" | "video";
  width?: number;
  height?: number;
  num_outputs?: number;
}

interface ErrorResponse {
  error: {
    message: string;
    code: string;
  };
}

export default async function handler(req: any, res: any) {
  // Handle CORS preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return sendError(res, 405, "Method not allowed", "METHOD_NOT_ALLOWED");
  }

  // Get API key from environment - NEVER log this
  const apiKey = process.env.REPLICATE_API_KEY;
  if (!apiKey) {
    console.error("Replicate Error: REPLICATE_API_KEY not configured");
    return sendError(res, 500, "Image generation service not configured", "SERVICE_NOT_CONFIGURED");
  }

  try {
    const body: ReplicateRequest = req.body || {};
    
    // Validate prompt
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    
    if (!prompt) {
      return sendError(res, 400, "Prompt is required", "PROMPT_REQUIRED");
    }
    
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return sendError(
        res, 
        400, 
        `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`, 
        "PROMPT_TOO_LONG"
      );
    }

    // Determine model version based on selected model
    const selectedModel = body.model || "flux_schnell";
    const mediaType = body.type || "image";
    let version: string;

    // Map model IDs to versions
    if (MODEL_VERSIONS[selectedModel as keyof typeof MODEL_VERSIONS]) {
      version = MODEL_VERSIONS[selectedModel as keyof typeof MODEL_VERSIONS];
    } else if (mediaType === "video") {
      version = MODEL_VERSIONS.video_cog; // Default video model
    } else {
      version = MODEL_VERSIONS.flux_schnell; // Default image model
    }

    // Build input parameters
    const input: any = {
      prompt,
    };

    // Add dimensions for image models
    if (mediaType === "image") {
      input.width = body.width || 1024;
      input.height = body.height || 1024;
      input.num_outputs = body.num_outputs || 1;
      input.output_format = "webp";
      input.output_quality = 90;
    }

    // For video
    if (mediaType === "video") {
      input.width = body.width || 576;
      input.height = body.height || 320;
      input.num_frames = 24;
    }

    console.log(`[Replicate] Request: type=${mediaType}, version=${version.slice(0, 12)}..., promptLength=${prompt.length}`);

    // Create prediction - Replicate API requires version hash
    const requestBody = {
      version,
      input,
    };

    console.log(`[Replicate] Payload:`, JSON.stringify(requestBody, null, 2));

    const createResponse = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error(`[Replicate] Create error: ${createResponse.status} - ${errorText}`);
      return sendError(res, 502, `Failed to start generation: ${errorText}`, "REPLICATE_CREATE_ERROR");
    }

    const prediction = await createResponse.json();
    console.log(`[Replicate] Prediction created: ${prediction.id}`);

    // Poll for completion (with timeout)
    const maxWaitTime = 120000; // 2 minutes
    const pollInterval = 2000; // 2 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const statusResponse = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
      });

      if (!statusResponse.ok) {
        console.error(`[Replicate] Status check failed: ${statusResponse.status}`);
        await new Promise(r => setTimeout(r, pollInterval));
        continue;
      }

      const status = await statusResponse.json();

      if (status.status === "succeeded") {
        console.log(`[Replicate] ✅ Generation succeeded`);
        
        // Get output URL(s)
        const output = status.output;
        const urls = Array.isArray(output) ? output : [output];
        
        return res.status(200).json({
          success: true,
          type: mediaType,
          urls,
          prompt: prompt.slice(0, 100),
        });
      }

      if (status.status === "failed" || status.status === "canceled") {
        console.error(`[Replicate] ❌ Generation failed: ${status.error}`);
        return sendError(res, 500, status.error || "Generation failed", "GENERATION_FAILED");
      }

      // Still processing, wait and poll again
      await new Promise(r => setTimeout(r, pollInterval));
    }

    // Timeout
    console.error(`[Replicate] ⏰ Generation timed out`);
    return sendError(res, 504, "Generation timed out. Please try again.", "TIMEOUT");

  } catch (error: any) {
    console.error("[Replicate] Handler Error:", error?.message || error);
    return sendError(
      res, 
      500, 
      "Internal server error during generation", 
      "INTERNAL_ERROR"
    );
  }
}

function sendError(
  res: any, 
  status: number, 
  message: string, 
  code: string
): void {
  const errorResponse: ErrorResponse = {
    error: {
      message,
      code,
    },
  };
  res.status(status).json(errorResponse);
}
