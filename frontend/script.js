import CurrencyController from "./controller/currency-controller";
import QuoteController from "./controller/quote-controller";
import CurrencyMaView from "./view/indicator-view";
import CurrencyView from "./view/currency-view";
import IndicatorController from "./controller/indicator-controller";

QuoteController.init();
CurrencyController.init();

//CurrencyController.init(CurrencyMaView)

IndicatorController.init();