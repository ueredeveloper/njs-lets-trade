const fetchAllCurrencies = async () => {
    // Fetch data from the backend endpoint
    let response = await fetch('http://localhost:3000/services/currencies', {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    })
        .then(response => {
            // Check if the response is successful
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            // Parse the JSON data
            return response.json();
        })
        .then(data => {
            // Process the retrieved data
            return data // Here you can handle the retrieved data as needed
        })
        .catch(error => {
            // Handle errors
            console.error('There was a problem with your fetch operation:', error);
        });

    return response;
 

}

export { fetchAllCurrencies }