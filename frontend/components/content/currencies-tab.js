import currenciesTable from "./currencies-table";


const currenciesTab = () => {
    return `
        <div class="tab-buttons">
            <!-- div for buttons -->
        </div>

        <div id="London" class="tabcontent">
            <h3>London</h3>
            <p>London is the capital city of England.</p>
            ${currenciesTable()}
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

export default currenciesTab;