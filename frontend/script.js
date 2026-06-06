import CurrencyController from "./controller/currency-controller";
import QuoteController from "./controller/quote-controller";
import IndicatorController from "./controller/indicator-controller";

import FavoriteController from "./controller/favorite-controller";
import FilterController from "./controller/filter-controller";
import ShangaiChartController from "./controller/shangai-chart-controller";
import SettingsController from "./controller/settings-controller";


ShangaiChartController.init()
FavoriteController.init();
FilterController.init()
QuoteController.init();
CurrencyController.init();
IndicatorController.init();
SettingsController.init();