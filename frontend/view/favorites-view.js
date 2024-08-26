import FavoriteModel from "../model/favorite-model";

const FavoriteView = {
  
  init: async function () {

    this.div = $('#favorite-container');

    this.favorites = FavoriteModel.getFavorites();
   
    this.renderList();


  },
  renderList: async function () {

    //this.favorites.map(favorite=> this.div.append(`<button>${favorite}</button>`))

    

  },


};

export default FavoriteView;
