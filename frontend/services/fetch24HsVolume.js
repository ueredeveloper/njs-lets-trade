/**
 * Fetches the 24-hour volume list from the backend API.
 
 */
const  fetch24hVolume = async () => {
  try {
    const response = await fetch("http://localhost:3000/services/24hs-volume", {
      method: "GET",
      headers: {
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error("Failed to fetch 24h volume");
    }

    return await response.json();
  } catch (error) {
    console.error("Error fetching 24h volume:", error);
    return [];
  }
}

export default fetch24hVolume;
