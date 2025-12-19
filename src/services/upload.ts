/**
 * Upload service for file uploads
 */
export async function upload({
  url,
  buffer,
  base64
}: {
  url?: string;
  buffer?: Buffer;
  base64?: string;
}) {
  const response = await fetch(`https://api.createanything.com/v0/upload`, {
    method: "POST",
    headers: {
      "Content-Type": buffer ? "application/octet-stream" : "application/json"
    },
    body: buffer ? (buffer as any) : JSON.stringify({ base64, url })
  });
  
  const data = await response.json();
  
  return {
    url: data.url,
    mimeType: data.mimeType || null
  };
}

export default upload;

