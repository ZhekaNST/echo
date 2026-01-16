// Vercel serverless function for proxying Solana RPC requests
// This ensures RPC calls work on Vercel production without 403 errors

export default async function handler(
  req: any,
  res: any,
) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // Get RPC endpoint from environment variable
    // Priority: Custom RPC URL with API key > Public endpoints
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const rpcApiKey = process.env.SOLANA_RPC_API_KEY;

    // Get the JSON-RPC request from the client
    const { method, params, id } = req.body;

    if (!method) {
      res.status(400).json({ error: 'Missing method in request body' });
      return;
    }

    // Build headers for RPC request
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add API key if provided (for Helius/QuickNode/Alchemy)
    if (rpcApiKey) {
      // Different providers use different header names
      if (rpcUrl.includes('helius')) {
        headers['Authorization'] = `Bearer ${rpcApiKey}`;
      } else if (rpcUrl.includes('quicknode')) {
        headers['x-api-key'] = rpcApiKey;
      } else if (rpcUrl.includes('alchemy')) {
        // Alchemy uses the API key in the URL, but we'll handle it here too
        headers['x-api-key'] = rpcApiKey;
      } else {
        // Generic API key header
        headers['Authorization'] = `Bearer ${rpcApiKey}`;
      }
    }

    // Forward the JSON-RPC request to the Solana RPC endpoint
    const rpcResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: id || 1,
        method,
        params: params || [],
      }),
    });

    const responseData = await rpcResponse.json();

    // Forward the response with proper status code
    res.status(rpcResponse.status).json(responseData);
  } catch (error: any) {
    console.error('Solana RPC proxy error:', error);
    res.status(500).json({
      error: 'RPC proxy error',
      message: error?.message || 'Unknown error',
    });
  }
}
