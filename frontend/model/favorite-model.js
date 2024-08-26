import CurrencyView from "../view/currency-view";

const FavoriteModel = {

  
  favorites: [
    {condiction: "ichimoku | conversion | above | baseline" , list: []}
  ],

  getFavorites: async function(){
    return this.favorites;
  }
  
};

export default FavoriteModel;