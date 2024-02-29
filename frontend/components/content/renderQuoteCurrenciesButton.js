const openCity = (evt, cityName) => {
    var i, tabcontent, tablinks;
    tabcontent = document.getElementsByClassName("tabcontent");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }
    tablinks = document.getElementsByClassName("tablinks");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }
    document.getElementById(cityName).style.display = "block";
    evt.currentTarget.className += " active";
};

const renderQuoteCurrenciesButton = (cityName) => {
    let button = document.createElement('button');
    button.textContent = cityName; // You can set the text content here
    button.onclick = (event) => openCity(event, cityName); // Assign the function reference, not the result of the function call
    return button;
};

export default renderQuoteCurrenciesButton;