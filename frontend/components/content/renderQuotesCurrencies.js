import renderCurrencies from "./renderCurrencies";

const openCity = (evt, cityName) => {
    console.log('clicked')
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

const renderQuoteCurrencies = () => {
    return `
        <div class="tab-buttons">
            <!-- div for buttons -->
        </div>

        <div id="London" class="tabcontent">
            <h3>London</h3>
            <p>London is the capital city of England.</p>
            ${renderCurrencies()}
        </div>

        <div id="Paris" class="tabcontent">
            <h3>Paris</h3>
            <p>Paris is the capital of France.</p> 
        </div>

        <div id="Tokyo" class="tabcontent">
            <h3>Tokyo</h3>
            <p>Tokyo is the capital of Japan.</p>
        </div>
    `;
};

export default renderQuoteCurrencies;
