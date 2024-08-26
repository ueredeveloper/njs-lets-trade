import * as echarts from 'echarts';

import './styles.css'
import CurrencyModel from '../model/currency-model';
import convertOpenTime from '../utils/convertOpenTime';

const ShangaiChartView = {
    

    init: function () {

        this.dom = document.getElementById('chart-container');
        this.shangaiIndex2 = echarts.init(this.dom, null, {
            renderer: 'canvas',
            useDirtyRect: false
        }),
            this.app = {};
        this.option;

        this.currency = {
            "symbol": "ETHUSDT",
            "interval": "1h",
            "ichimokuCloud": [{
                "conversion": 2930.58,
                "base": 2930.58,
                "spanA": 2930.58,
                "spanB": 2930.58
            },
            {
                "conversion": 2933.385,
                "base": 2930.58,
                "spanA": 2931.9825,
                "spanB": 2930.58
            },
            {
                "conversion": 2933.385,
                "base": 2930.58,
                "spanA": 2931.9825,
                "spanB": 2930.58
            },
            {
                "conversion": 2934.5,
                "base": 2930.58,
                "spanA": 2932.54,
                "spanB": 2930.58
            },
            {
                "conversion": 2955.9300000000003,
                "base": 2930.58,
                "spanA": 2943.255,
                "spanB": 2930.58
            },
            {
                "conversion": 2972.4,
                "base": 2930.58,
                "spanA": 2951.49,
                "spanB": 2930.58
            },
            {
                "conversion": 2965.8,
                "base": 2930.58,
                "spanA": 2948.19,
                "spanB": 2930.58
            },
            {
                "conversion": 2958.13,
                "base": 2930.58,
                "spanA": 2944.355,
                "spanB": 2930.58
            },
            {
                "conversion": 2957.83,
                "base": 2930.58,
                "spanA": 2944.205,
                "spanB": 2930.58
            },
            {
                "conversion": 2957.83,
                "base": 2930.58,
                "spanA": 2944.205,
                "spanB": 2930.58
            },
            {
                "conversion": 2957.83,
                "base": 2930.58,
                "spanA": 2944.205,
                "spanB": 2930.58
            },
            {
                "conversion": 2953.2749999999996,
                "base": 2930.58,
                "spanA": 2941.9275,
                "spanB": 2930.58
            },
            {
                "conversion": 2953.2749999999996,
                "base": 2930.58,
                "spanA": 2941.9275,
                "spanB": 2930.58
            },
            {
                "conversion": 2953.2749999999996,
                "base": 2930.58,
                "spanA": 2941.9275,
                "spanB": 2930.58
            },
            {
                "conversion": 2953.2749999999996,
                "base": 2930.58,
                "spanA": 2941.9275,
                "spanB": 2930.58
            },
            {
                "conversion": 2944.63,
                "base": 2930.58,
                "spanA": 2937.605,
                "spanB": 2930.58
            },
            {
                "conversion": 2948.63,
                "base": 2930.58,
                "spanA": 2939.605,
                "spanB": 2930.58
            },
            {
                "conversion": 2945.8050000000003,
                "base": 2930.58,
                "spanA": 2938.1925,
                "spanB": 2930.58
            },
            {
                "conversion": 2945.8050000000003,
                "base": 2933.385,
                "spanA": 2939.5950000000003,
                "spanB": 2930.58
            },
            {
                "conversion": 2921.4449999999997,
                "base": 2933.385,
                "spanA": 2927.415,
                "spanB": 2930.58
            },
            {
                "conversion": 2921.4449999999997,
                "base": 2934.5,
                "spanA": 2927.9725,
                "spanB": 2930.58
            },
            {
                "conversion": 2921.4449999999997,
                "base": 2939.3450000000003,
                "spanA": 2930.395,
                "spanB": 2930.58
            },
            {
                "conversion": 2921.4449999999997,
                "base": 2939.3450000000003,
                "spanA": 2930.395,
                "spanB": 2930.58
            },
            {
                "conversion": 2919.55,
                "base": 2939.3450000000003,
                "spanA": 2929.4475,
                "spanB": 2930.58
            },
            {
                "conversion": 2919.55,
                "base": 2934.9449999999997,
                "spanA": 2927.2475,
                "spanB": 2930.58
            },
            {
                "conversion": 2915.6800000000003,
                "base": 2934.645,
                "spanA": 2925.1625000000004,
                "spanB": 2930.58
            },
            {
                "conversion": 2915.6800000000003,
                "base": 2934.645,
                "spanA": 2925.1625000000004,
                "spanB": 2930.58
            },
            {
                "conversion": 2906.4700000000003,
                "base": 2928.625,
                "spanA": 2917.5475,
                "spanB": 2930.58
            },
            {
                "conversion": 2897.1949999999997,
                "base": 2924.0699999999997,
                "spanA": 2910.6324999999997,
                "spanB": 2930.58
            },
            {
                "conversion": 2897.1949999999997,
                "base": 2924.0699999999997,
                "spanA": 2910.6324999999997,
                "spanB": 2930.58
            },
            {
                "conversion": 2893.0699999999997,
                "base": 2919.9449999999997,
                "spanA": 2906.5074999999997,
                "spanB": 2929.2
            },
            {
                "conversion": 2893.0699999999997,
                "base": 2919.9449999999997,
                "spanA": 2906.5074999999997,
                "spanB": 2929.2
            },
            {
                "conversion": 2893.0699999999997,
                "base": 2911.3,
                "spanA": 2902.185,
                "spanB": 2929.2
            },
            {
                "conversion": 2893.0699999999997,
                "base": 2911.3,
                "spanA": 2902.185,
                "spanB": 2929.2
            },
            {
                "conversion": 2893.0699999999997,
                "base": 2911.3,
                "spanA": 2902.185,
                "spanB": 2929.2
            },
            {
                "conversion": 2893.0699999999997,
                "base": 2911.3,
                "spanA": 2902.185,
                "spanB": 2929.2
            },
            {
                "conversion": 2888.9700000000003,
                "base": 2911.3,
                "spanA": 2900.135,
                "spanB": 2929.2
            },
            {
                "conversion": 2882.5,
                "base": 2911.3,
                "spanA": 2896.9,
                "spanB": 2929.2
            },
            {
                "conversion": 2882.5,
                "base": 2911.3,
                "spanA": 2896.9,
                "spanB": 2929.2
            },
            {
                "conversion": 2883.375,
                "base": 2911.3,
                "spanA": 2897.3375,
                "spanB": 2929.2
            },
            {
                "conversion": 2883.415,
                "base": 2909.4049999999997,
                "spanA": 2896.41,
                "spanB": 2929.2
            },
            {
                "conversion": 2884.24,
                "base": 2909.4049999999997,
                "spanA": 2896.8224999999998,
                "spanB": 2929.2
            },
            {
                "conversion": 2888.4849999999997,
                "base": 2905.535,
                "spanA": 2897.0099999999998,
                "spanB": 2929.2
            },
            {
                "conversion": 2888.4849999999997,
                "base": 2905.535,
                "spanA": 2897.0099999999998,
                "spanB": 2929.2
            },
            {
                "conversion": 2892.875,
                "base": 2902.3450000000003,
                "spanA": 2897.61,
                "spanB": 2929.2
            },
            {
                "conversion": 2892.875,
                "base": 2893.0699999999997,
                "spanA": 2892.9725,
                "spanB": 2929.2
            },
            {
                "conversion": 2895.365,
                "base": 2893.0699999999997,
                "spanA": 2894.2174999999997,
                "spanB": 2929.2
            },
            {
                "conversion": 2903.9750000000004,
                "base": 2893.0699999999997,
                "spanA": 2898.5225,
                "spanB": 2929.2
            },
            {
                "conversion": 2905.285,
                "base": 2893.0699999999997,
                "spanA": 2899.1775,
                "spanB": 2929.2
            },
            {
                "conversion": 2922.755,
                "base": 2910.35,
                "spanA": 2916.5525,
                "spanB": 2929.2
            },
            {
                "conversion": 2934.4049999999997,
                "base": 2922,
                "spanA": 2928.2025,
                "spanB": 2924.8
            },
            {
                "conversion": 2934.4049999999997,
                "base": 2922,
                "spanA": 2928.2025,
                "spanB": 2924.5
            },
            {
                "conversion": 2939.8999999999996,
                "base": 2927.495,
                "spanA": 2933.6974999999998,
                "spanB": 2927.495
            },
            {
                "conversion": 2939.8999999999996,
                "base": 2927.495,
                "spanA": 2933.6974999999998,
                "spanB": 2927.495
            },
            {
                "conversion": 2939.8999999999996,
                "base": 2927.495,
                "spanA": 2933.6974999999998,
                "spanB": 2927.495
            },
            {
                "conversion": 2947.7200000000003,
                "base": 2935.315,
                "spanA": 2941.5175,
                "spanB": 2935.315
            },
            {
                "conversion": 2956.385,
                "base": 2944.855,
                "spanA": 2950.62,
                "spanB": 2943.98
            },
            {
                "conversion": 2961.01,
                "base": 2946.375,
                "spanA": 2953.6925,
                "spanB": 2945.5
            },
            {
                "conversion": 2982.215,
                "base": 2946.375,
                "spanA": 2964.295,
                "spanB": 2945.5
            },
            {
                "conversion": 2987,
                "base": 2946.375,
                "spanA": 2966.6875,
                "spanB": 2945.5
            },
            {
                "conversion": 3005.275,
                "base": 2952.5550000000003,
                "spanA": 2978.915,
                "spanB": 2951.6800000000003
            },
            {
                "conversion": 3005.6800000000003,
                "base": 2952.5550000000003,
                "spanA": 2979.1175000000003,
                "spanB": 2951.6800000000003
            },
            {
                "conversion": 3007.2650000000003,
                "base": 2952.5550000000003,
                "spanA": 2979.9100000000003,
                "spanB": 2951.6800000000003
            },
            {
                "conversion": 3011.955,
                "base": 2955.045,
                "spanA": 2983.5,
                "spanB": 2951.6800000000003
            },
            {
                "conversion": 3016.27,
                "base": 2962.775,
                "spanA": 2989.5225,
                "spanB": 2951.6800000000003
            },
            {
                "conversion": 3019.1800000000003,
                "base": 2964.085,
                "spanA": 2991.6325,
                "spanB": 2951.6800000000003
            },
            {
                "conversion": 3019.1800000000003,
                "base": 2964.085,
                "spanA": 2991.6325,
                "spanB": 2951.6800000000003
            },
            {
                "conversion": 3019.1800000000003,
                "base": 2964.085,
                "spanA": 2991.6325,
                "spanB": 2951.6800000000003
            },
            {
                "conversion": 3019.1800000000003,
                "base": 2964.085,
                "spanA": 2991.6325,
                "spanB": 2951.6800000000003
            },
            {
                "conversion": 3019.12,
                "base": 2964.085,
                "spanA": 2991.6025,
                "spanB": 2951.6800000000003
            },
            {
                "conversion": 3012.425,
                "base": 2964.085,
                "spanA": 2988.255,
                "spanB": 2951.6800000000003
            },
            {
                "conversion": 3008.785,
                "base": 2964.085,
                "spanA": 2986.435,
                "spanB": 2951.6800000000003
            },
            {
                "conversion": 3008.785,
                "base": 2964.085,
                "spanA": 2986.435,
                "spanB": 2951.6800000000003
            },
            {
                "conversion": 3000.8450000000003,
                "base": 2964.085,
                "spanA": 2982.465,
                "spanB": 2951.6800000000003
            },
            {
                "conversion": 2997.425,
                "base": 2967.19,
                "spanA": 2982.3075,
                "spanB": 2951.6800000000003
            },
            {
                "conversion": 2982.7749999999996,
                "base": 2988.395,
                "spanA": 2985.585,
                "spanB": 2951.6800000000003
            },
            {
                "conversion": 2979.45,
                "base": 2986.205,
                "spanA": 2982.8275,
                "spanB": 2951.6800000000003
            },
            {
                "conversion": 2979.45,
                "base": 2986.205,
                "spanA": 2982.8275,
                "spanB": 2951.6800000000003
            },
            {
                "conversion": 2967.71,
                "base": 2983.19,
                "spanA": 2975.45,
                "spanB": 2951.6800000000003
            },
            {
                "conversion": 2967.71,
                "base": 2983.19,
                "spanA": 2975.45,
                "spanB": 2951.6800000000003
            },
            {
                "conversion": 2967.1099999999997,
                "base": 2983.19,
                "spanA": 2975.1499999999996,
                "spanB": 2951.6800000000003
            },
            {
                "conversion": 2967.0699999999997,
                "base": 2983.19,
                "spanA": 2975.13,
                "spanB": 2951.6800000000003
            },
            {
                "conversion": 2956.4449999999997,
                "base": 2983.19,
                "spanA": 2969.8175,
                "spanB": 2952.5550000000003
            },
            {
                "conversion": 2955.035,
                "base": 2982.08,
                "spanA": 2968.5575,
                "spanB": 2952.5550000000003
            },
            {
                "conversion": 2942.25,
                "base": 2982.08,
                "spanA": 2962.165,
                "spanB": 2952.5550000000003
            },
            {
                "conversion": 2941.7200000000003,
                "base": 2982.08,
                "spanA": 2961.9,
                "spanB": 2952.5550000000003
            },
            {
                "conversion": 2939.485,
                "base": 2982.02,
                "spanA": 2960.7525,
                "spanB": 2952.5550000000003
            },
            {
                "conversion": 2939.485,
                "base": 2975.325,
                "spanA": 2957.4049999999997,
                "spanB": 2952.5550000000003
            },
            {
                "conversion": 2939.54,
                "base": 2975.325,
                "spanA": 2957.4325,
                "spanB": 2952.5550000000003
            },
            {
                "conversion": 2939.9,
                "base": 2975.325,
                "spanA": 2957.6125,
                "spanB": 2955.045
            },
            {
                "conversion": 2939.9,
                "base": 2975.325,
                "spanA": 2957.6125,
                "spanB": 2962.775
            },
            {
                "conversion": 2945.395,
                "base": 2975.325,
                "spanA": 2960.3599999999997,
                "spanB": 2964.085
            },
            {
                "conversion": 2982.4049999999997,
                "base": 2977.9,
                "spanA": 2980.1525,
                "spanB": 2964.085
            },
            {
                "conversion": 2996.295,
                "base": 2991.165,
                "spanA": 2993.73,
                "spanB": 2973.17
            },
            {
                "conversion": 2996.295,
                "base": 2991.165,
                "spanA": 2993.73,
                "spanB": 2973.17
            },
            {
                "conversion": 2999.7650000000003,
                "base": 2991.165,
                "spanA": 2995.465,
                "spanB": 2973.17
            },
            {
                "conversion": 2999.7650000000003,
                "base": 2991.165,
                "spanA": 2995.465,
                "spanB": 2973.17
            },
            {
                "conversion": 3012.45,
                "base": 3003.8500000000004,
                "spanA": 3008.15,
                "spanB": 2985.855
            },
            {
                "conversion": 3014.295,
                "base": 3005.695,
                "spanA": 3009.995,
                "spanB": 2987.7
            },
            {
                "conversion": 3017.275,
                "base": 3008.675,
                "spanA": 3012.9750000000004,
                "spanB": 2990.6800000000003
            },
            {
                "conversion": 3039.495,
                "base": 3020.67,
                "spanA": 3030.0825,
                "spanB": 3005.7799999999997
            },
            {
                "conversion": 3068.87,
                "base": 3021.4,
                "spanA": 3045.135,
                "spanB": 3021.4
            },
            {
                "conversion": 3069,
                "base": 3021.4,
                "spanA": 3045.2,
                "spanB": 3021.4
            },
            {
                "conversion": 3069,
                "base": 3021.4,
                "spanA": 3045.2,
                "spanB": 3021.4
            },
            {
                "conversion": 3070.05,
                "base": 3021.4,
                "spanA": 3045.7250000000004,
                "spanB": 3021.4
            },
            {
                "conversion": 3070.05,
                "base": 3021.4,
                "spanA": 3045.7250000000004,
                "spanB": 3021.4
            },
            {
                "conversion": 3086.74,
                "base": 3021.4,
                "spanA": 3054.0699999999997,
                "spanB": 3021.4
            },
            {
                "conversion": 3088.62,
                "base": 3021.4,
                "spanA": 3055.01,
                "spanB": 3021.4
            },
            {
                "conversion": 3093.58,
                "base": 3021.4,
                "spanA": 3057.49,
                "spanB": 3021.4
            },
            {
                "conversion": 3093.58,
                "base": 3025.9049999999997,
                "spanA": 3059.7425,
                "spanB": 3021.4
            },
            {
                "conversion": 3084.975,
                "base": 3026.5299999999997,
                "spanA": 3055.7524999999996,
                "spanB": 3021.4
            },
            {
                "conversion": 3088.2799999999997,
                "base": 3026.5299999999997,
                "spanA": 3057.4049999999997,
                "spanB": 3021.4
            },
            {
                "conversion": 3102.92,
                "base": 3033.33,
                "spanA": 3068.125,
                "spanB": 3024.73
            },
            {
                "conversion": 3103.625,
                "base": 3033.33,
                "spanA": 3068.4775,
                "spanB": 3024.73
            },
            {
                "conversion": 3105.135,
                "base": 3033.33,
                "spanA": 3069.2325,
                "spanB": 3024.73
            }
            ],
            "candlesticks": [{
                "openTime": 1715054400000,
                "open": "3049.19000000",
                "high": "3067.65000000",
                "low": "3044.01000000",
                "close": "3066.17000000",
                "volume": "8773.31350000",
                "closeTime": 1715057999999,
                "quoteVolume": "26821909.15030000",
                "trades": 25344,
                "baseAssetVolume": "4172.03430000",
                "quoteAssetVolume": "12757471.12974200"
            },
            {
                "openTime": 1715058000000,
                "open": "3066.18000000",
                "high": "3081.55000000",
                "low": "3055.32000000",
                "close": "3069.39000000",
                "volume": "7582.39180000",
                "closeTime": 1715061599999,
                "quoteVolume": "23265150.12565400",
                "trades": 25293,
                "baseAssetVolume": "3378.56600000",
                "quoteAssetVolume": "10368477.66910700"
            },
            {
                "openTime": 1715061600000,
                "open": "3069.38000000",
                "high": "3075.99000000",
                "low": "3058.15000000",
                "close": "3069.36000000",
                "volume": "6225.98080000",
                "closeTime": 1715065199999,
                "quoteVolume": "19089572.82911200",
                "trades": 20597,
                "baseAssetVolume": "3167.60760000",
                "quoteAssetVolume": "9711540.78684900"
            },
            {
                "openTime": 1715065200000,
                "open": "3069.36000000",
                "high": "3082.50000000",
                "low": "3064.00000000",
                "close": "3077.40000000",
                "volume": "6780.67220000",
                "closeTime": 1715068799999,
                "quoteVolume": "20861260.74766500",
                "trades": 21732,
                "baseAssetVolume": "3466.29360000",
                "quoteAssetVolume": "10664945.97183100"
            },
            {
                "openTime": 1715068800000,
                "open": "3077.40000000",
                "high": "3125.54000000",
                "low": "3074.21000000",
                "close": "3119.40000000",
                "volume": "39142.13760000",
                "closeTime": 1715072399999,
                "quoteVolume": "121738844.21827600",
                "trades": 81641,
                "baseAssetVolume": "19769.06030000",
                "quoteAssetVolume": "61485330.15702700"
            },
            {
                "openTime": 1715072400000,
                "open": "3119.39000000",
                "high": "3129.85000000",
                "low": "3108.71000000",
                "close": "3113.01000000",
                "volume": "11248.97700000",
                "closeTime": 1715075999999,
                "quoteVolume": "35114331.63352100",
                "trades": 31355,
                "baseAssetVolume": "5506.67610000",
                "quoteAssetVolume": "17192446.94982800"
            },
            {
                "openTime": 1715076000000,
                "open": "3113.02000000",
                "high": "3115.00000000",
                "low": "3089.79000000",
                "close": "3100.01000000",
                "volume": "12974.28820000",
                "closeTime": 1715079599999,
                "quoteVolume": "40226911.95626200",
                "trades": 33307,
                "baseAssetVolume": "6712.80260000",
                "quoteAssetVolume": "20811243.98111000"
            },
            {
                "openTime": 1715079600000,
                "open": "3100.01000000",
                "high": "3105.49000000",
                "low": "3059.09000000",
                "close": "3063.39000000",
                "volume": "15731.31030000",
                "closeTime": 1715083199999,
                "quoteVolume": "48482686.47702500",
                "trades": 45217,
                "baseAssetVolume": "6951.17220000",
                "quoteAssetVolume": "21430005.70504200"
            },
            {
                "openTime": 1715083200000,
                "open": "3063.40000000",
                "high": "3083.49000000",
                "low": "3063.22000000",
                "close": "3075.91000000",
                "volume": "9548.92960000",
                "closeTime": 1715086799999,
                "quoteVolume": "29335578.10735400",
                "trades": 28210,
                "baseAssetVolume": "4911.61200000",
                "quoteAssetVolume": "15090343.23090000"
            },
            {
                "openTime": 1715086800000,
                "open": "3075.91000000",
                "high": "3081.45000000",
                "low": "3048.62000000",
                "close": "3060.62000000",
                "volume": "14548.98590000",
                "closeTime": 1715090399999,
                "quoteVolume": "44634436.33000600",
                "trades": 38661,
                "baseAssetVolume": "6773.41510000",
                "quoteAssetVolume": "20783086.61886800"
            },
            {
                "openTime": 1715090400000,
                "open": "3060.63000000",
                "high": "3092.73000000",
                "low": "3045.70000000",
                "close": "3091.79000000",
                "volume": "15430.30320000",
                "closeTime": 1715093999999,
                "quoteVolume": "47352013.13537800",
                "trades": 43959,
                "baseAssetVolume": "8187.82190000",
                "quoteAssetVolume": "25133475.79054200"
            },
            {
                "openTime": 1715094000000,
                "open": "3091.80000000",
                "high": "3106.00000000",
                "low": "3068.40000000",
                "close": "3071.41000000",
                "volume": "20242.91050000",
                "closeTime": 1715097599999,
                "quoteVolume": "62430236.04040100",
                "trades": 45348,
                "baseAssetVolume": "9755.26910000",
                "quoteAssetVolume": "30089211.17921000"
            },
            {
                "openTime": 1715097600000,
                "open": "3071.41000000",
                "high": "3079.41000000",
                "low": "3061.00000000",
                "close": "3071.30000000",
                "volume": "7247.37970000",
                "closeTime": 1715101199999,
                "quoteVolume": "22244005.25134000",
                "trades": 24260,
                "baseAssetVolume": "3311.42590000",
                "quoteAssetVolume": "10164392.91431800"
            },
            {
                "openTime": 1715101200000,
                "open": "3071.30000000",
                "high": "3071.78000000",
                "low": "3054.90000000",
                "close": "3059.39000000",
                "volume": "7354.99480000",
                "closeTime": 1715104799999,
                "quoteVolume": "22518369.85656800",
                "trades": 23626,
                "baseAssetVolume": "3098.81020000",
                "quoteAssetVolume": "9487661.34543600"
            },
            {
                "openTime": 1715104800000,
                "open": "3059.39000000",
                "high": "3059.88000000",
                "low": "3027.00000000",
                "close": "3047.92000000",
                "volume": "12967.42130000",
                "closeTime": 1715108399999,
                "quoteVolume": "39447346.54659500",
                "trades": 42425,
                "baseAssetVolume": "6034.92770000",
                "quoteAssetVolume": "18359215.33433600"
            },
            {
                "openTime": 1715108400000,
                "open": "3047.92000000",
                "high": "3055.41000000",
                "low": "3044.40000000",
                "close": "3049.62000000",
                "volume": "6351.58460000",
                "closeTime": 1715111999999,
                "quoteVolume": "19379077.55218600",
                "trades": 22671,
                "baseAssetVolume": "2933.45160000",
                "quoteAssetVolume": "8950039.42434700"
            },
            {
                "openTime": 1715112000000,
                "open": "3049.61000000",
                "high": "3059.10000000",
                "low": "3034.54000000",
                "close": "3048.16000000",
                "volume": "6779.91880000",
                "closeTime": 1715115599999,
                "quoteVolume": "20670500.66965500",
                "trades": 23181,
                "baseAssetVolume": "3366.95500000",
                "quoteAssetVolume": "10265213.13714600"
            },
            {
                "openTime": 1715115600000,
                "open": "3048.15000000",
                "high": "3061.44000000",
                "low": "3035.89000000",
                "close": "3040.13000000",
                "volume": "5703.55960000",
                "closeTime": 1715119199999,
                "quoteVolume": "17403617.11093100",
                "trades": 18747,
                "baseAssetVolume": "3089.42200000",
                "quoteAssetVolume": "9429174.29844400"
            },
            {
                "openTime": 1715119200000,
                "open": "3051.20000000",
                "high": "3052.85000000",
                "low": "3028.06000000",
                "close": "3036.64000000",
                "volume": "7366.75640000",
                "closeTime": 1715122799999,
                "quoteVolume": "22414966.18293000",
                "trades": 26980,
                "baseAssetVolume": "3444.08920000",
                "quoteAssetVolume": "10481496.35979200"
            },
            {
                "openTime": 1715122800000,
                "open": "3036.64000000",
                "high": "3037.80000000",
                "low": "2998.00000000",
                "close": "3004.35000000",
                "volume": "27118.18260000",
                "closeTime": 1715126399999,
                "quoteVolume": "81683331.12828700",
                "trades": 54510,
                "baseAssetVolume": "9803.41600000",
                "quoteAssetVolume": "29552548.66155500"
            },
            {
                "openTime": 1715126400000,
                "open": "3005.69000000",
                "high": "3023.74000000",
                "low": "2994.58000000",
                "close": "3020.25000000",
                "volume": "13053.17860000",
                "closeTime": 1715129999999,
                "quoteVolume": "39330675.66415000",
                "trades": 42222,
                "baseAssetVolume": "6648.26140000",
                "quoteAssetVolume": "20033892.46239300"
            },
            {
                "openTime": 1715130000000,
                "open": "3020.26000000",
                "high": "3030.00000000",
                "low": "3015.01000000",
                "close": "3027.77000000",
                "volume": "5616.77950000",
                "closeTime": 1715133599999,
                "quoteVolume": "16982562.58065500",
                "trades": 18857,
                "baseAssetVolume": "2997.39510000",
                "quoteAssetVolume": "9064511.93865400"
            },
            {
                "openTime": 1715133600000,
                "open": "3024.24000000",
                "high": "3034.35000000",
                "low": "3024.24000000",
                "close": "3026.10000000",
                "volume": "5555.11070000",
                "closeTime": 1715137199999,
                "quoteVolume": "16830750.39359400",
                "trades": 18936,
                "baseAssetVolume": "2654.00730000",
                "quoteAssetVolume": "8041006.43086800"
            },
            {
                "openTime": 1715137200000,
                "open": "3026.11000000",
                "high": "3038.15000000",
                "low": "3018.94000000",
                "close": "3032.33000000",
                "volume": "4872.04550000",
                "closeTime": 1715140799999,
                "quoteVolume": "14760616.55180900",
                "trades": 17035,
                "baseAssetVolume": "2777.28720000",
                "quoteAssetVolume": "8415878.30462800"
            },
            {
                "openTime": 1715140800000,
                "open": "3032.32000000",
                "high": "3036.52000000",
                "low": "3000.28000000",
                "close": "3012.81000000",
                "volume": "10382.97960000",
                "closeTime": 1715144399999,
                "quoteVolume": "31346160.24668100",
                "trades": 29555,
                "baseAssetVolume": "4690.15420000",
                "quoteAssetVolume": "14160714.59700900"
            },
            {
                "openTime": 1715144400000,
                "open": "3012.80000000",
                "high": "3028.90000000",
                "low": "3004.60000000",
                "close": "3025.81000000",
                "volume": "6239.31490000",
                "closeTime": 1715147999999,
                "quoteVolume": "18823184.25010000",
                "trades": 21907,
                "baseAssetVolume": "3583.11880000",
                "quoteAssetVolume": "10810972.70243800"
            },
            {
                "openTime": 1715148000000,
                "open": "3025.80000000",
                "high": "3030.43000000",
                "low": "2994.66000000",
                "close": "3015.19000000",
                "volume": "18190.75370000",
                "closeTime": 1715151599999,
                "quoteVolume": "54773969.17475600",
                "trades": 42761,
                "baseAssetVolume": "9372.91030000",
                "quoteAssetVolume": "28228757.03881000"
            },
            {
                "openTime": 1715151600000,
                "open": "3015.19000000",
                "high": "3022.00000000",
                "low": "2989.56000000",
                "close": "2995.01000000",
                "volume": "13511.48660000",
                "closeTime": 1715155199999,
                "quoteVolume": "40567559.75928700",
                "trades": 36241,
                "baseAssetVolume": "5924.48730000",
                "quoteAssetVolume": "17791968.68657100"
            },
            {
                "openTime": 1715155200000,
                "open": "2995.01000000",
                "high": "3009.33000000",
                "low": "2982.89000000",
                "close": "3001.28000000",
                "volume": "12875.54510000",
                "closeTime": 1715158799999,
                "quoteVolume": "38574215.71368200",
                "trades": 39591,
                "baseAssetVolume": "6573.21110000",
                "quoteAssetVolume": "19698026.62487900"
            },
            {
                "openTime": 1715158800000,
                "open": "3001.28000000",
                "high": "3006.10000000",
                "low": "2978.40000000",
                "close": "2998.42000000",
                "volume": "13765.33140000",
                "closeTime": 1715162399999,
                "quoteVolume": "41142829.23369000",
                "trades": 46677,
                "baseAssetVolume": "6584.75020000",
                "quoteAssetVolume": "19682354.58922700"
            },
            {
                "openTime": 1715162400000,
                "open": "2998.43000000",
                "high": "3011.40000000",
                "low": "2996.06000000",
                "close": "3004.53000000",
                "volume": "11363.32210000",
                "closeTime": 1715165999999,
                "quoteVolume": "34126846.23193900",
                "trades": 32306,
                "baseAssetVolume": "6650.67580000",
                "quoteAssetVolume": "19973931.43612200"
            },
            {
                "openTime": 1715166000000,
                "open": "3004.53000000",
                "high": "3006.20000000",
                "low": "2982.00000000",
                "close": "2990.31000000",
                "volume": "8332.33610000",
                "closeTime": 1715169599999,
                "quoteVolume": "24932811.27237700",
                "trades": 30576,
                "baseAssetVolume": "4021.59030000",
                "quoteAssetVolume": "12033944.98460400"
            },
            {
                "openTime": 1715169600000,
                "open": "2990.31000000",
                "high": "3006.96000000",
                "low": "2985.00000000",
                "close": "3002.26000000",
                "volume": "9694.12560000",
                "closeTime": 1715173199999,
                "quoteVolume": "29050749.40492900",
                "trades": 33256,
                "baseAssetVolume": "5286.67370000",
                "quoteAssetVolume": "15844682.00801500"
            },
            {
                "openTime": 1715173200000,
                "open": "3002.26000000",
                "high": "3032.42000000",
                "low": "2988.89000000",
                "close": "3027.79000000",
                "volume": "18780.92590000",
                "closeTime": 1715176799999,
                "quoteVolume": "56512425.72167600",
                "trades": 55463,
                "baseAssetVolume": "10032.76050000",
                "quoteAssetVolume": "30199138.23194200"
            },
            {
                "openTime": 1715176800000,
                "open": "3027.80000000",
                "high": "3032.50000000",
                "low": "3008.40000000",
                "close": "3020.22000000",
                "volume": "15738.64620000",
                "closeTime": 1715180399999,
                "quoteVolume": "47566823.41044000",
                "trades": 44611,
                "baseAssetVolume": "7590.97600000",
                "quoteAssetVolume": "22947326.00403100"
            },
            {
                "openTime": 1715180400000,
                "open": "3020.22000000",
                "high": "3023.08000000",
                "low": "2986.00000000",
                "close": "3006.98000000",
                "volume": "15447.95810000",
                "closeTime": 1715183999999,
                "quoteVolume": "46375751.16895900",
                "trades": 49313,
                "baseAssetVolume": "7459.48300000",
                "quoteAssetVolume": "22393816.51536700"
            },
            {
                "openTime": 1715184000000,
                "open": "3006.99000000",
                "high": "3016.16000000",
                "low": "2992.45000000",
                "close": "3016.15000000",
                "volume": "7254.09500000",
                "closeTime": 1715187599999,
                "quoteVolume": "21802371.16625100",
                "trades": 29244,
                "baseAssetVolume": "3829.29510000",
                "quoteAssetVolume": "11508859.59615900"
            },
            {
                "openTime": 1715187600000,
                "open": "3016.15000000",
                "high": "3024.11000000",
                "low": "3005.38000000",
                "close": "3011.09000000",
                "volume": "6506.73250000",
                "closeTime": 1715191199999,
                "quoteVolume": "19610362.98459800",
                "trades": 24168,
                "baseAssetVolume": "3237.46280000",
                "quoteAssetVolume": "9758842.13375900"
            },
            {
                "openTime": 1715191200000,
                "open": "3011.10000000",
                "high": "3022.16000000",
                "low": "3008.94000000",
                "close": "3009.50000000",
                "volume": "4298.04770000",
                "closeTime": 1715194799999,
                "quoteVolume": "12957466.89356300",
                "trades": 17382,
                "baseAssetVolume": "2093.88970000",
                "quoteAssetVolume": "6311846.16025100"
            },
            {
                "openTime": 1715194800000,
                "open": "3009.50000000",
                "high": "3015.40000000",
                "low": "2986.58000000",
                "close": "2999.38000000",
                "volume": "7955.71360000",
                "closeTime": 1715198399999,
                "quoteVolume": "23867081.21884000",
                "trades": 28855,
                "baseAssetVolume": "3401.57130000",
                "quoteAssetVolume": "10204174.84263600"
            },
            {
                "openTime": 1715198400000,
                "open": "2999.39000000",
                "high": "3004.00000000",
                "low": "2936.48000000",
                "close": "2951.61000000",
                "volume": "25973.95500000",
                "closeTime": 1715201999999,
                "quoteVolume": "76891160.03471600",
                "trades": 72514,
                "baseAssetVolume": "11730.75780000",
                "quoteAssetVolume": "34715092.68098900"
            },
            {
                "openTime": 1715202000000,
                "open": "2951.61000000",
                "high": "2982.31000000",
                "low": "2942.74000000",
                "close": "2972.01000000",
                "volume": "12376.92590000",
                "closeTime": 1715205599999,
                "quoteVolume": "36693897.95712700",
                "trades": 35754,
                "baseAssetVolume": "6739.43040000",
                "quoteAssetVolume": "19976472.27569000"
            },
            {
                "openTime": 1715205600000,
                "open": "2972.00000000",
                "high": "2974.75000000",
                "low": "2953.92000000",
                "close": "2969.18000000",
                "volume": "9259.00680000",
                "closeTime": 1715209199999,
                "quoteVolume": "27458667.43684600",
                "trades": 30748,
                "baseAssetVolume": "4309.96320000",
                "quoteAssetVolume": "12783747.31766500"
            },
            {
                "openTime": 1715209200000,
                "open": "2969.17000000",
                "high": "2977.50000000",
                "low": "2961.73000000",
                "close": "2974.21000000",
                "volume": "7962.70330000",
                "closeTime": 1715212799999,
                "quoteVolume": "23645197.77769400",
                "trades": 27278,
                "baseAssetVolume": "4337.42620000",
                "quoteAssetVolume": "12880869.82301100"
            },
            {
                "openTime": 1715212800000,
                "open": "2974.20000000",
                "high": "2978.90000000",
                "low": "2972.55000000",
                "close": "2978.55000000",
                "volume": "704.81270000",
                "closeTime": 1715216399999,
                "quoteVolume": "2097567.40068500",
                "trades": 2210,
                "baseAssetVolume": "428.63390000",
                "quoteAssetVolume": "1275752.58959500"
            },
            {
                "openTime": 1715216400000,
                "open": "2987.41000000",
                "high": "2999.49000000",
                "low": "2987.20000000",
                "close": "2997.33000000",
                "volume": "7149.58510000",
                "closeTime": 1715219999999,
                "quoteVolume": "21398453.88997800",
                "trades": 21468,
                "baseAssetVolume": "3727.10350000",
                "quoteAssetVolume": "11155701.44570500"
            },
            {
                "openTime": 1715220000000,
                "open": "2997.33000000",
                "high": "3005.10000000",
                "low": "2993.00000000",
                "close": "2998.49000000",
                "volume": "5358.45520000",
                "closeTime": 1715223599999,
                "quoteVolume": "16068339.81591200",
                "trades": 17120,
                "baseAssetVolume": "2684.89720000",
                "quoteAssetVolume": "8050843.61152100"
            },
            {
                "openTime": 1715223600000,
                "open": "2998.49000000",
                "high": "3003.00000000",
                "low": "2987.98000000",
                "close": "2997.90000000",
                "volume": "5873.54360000",
                "closeTime": 1715227199999,
                "quoteVolume": "17597334.13119300",
                "trades": 20022,
                "baseAssetVolume": "3355.96840000",
                "quoteAssetVolume": "10055377.66086800"
            },
            {
                "openTime": 1715227200000,
                "open": "2997.91000000",
                "high": "3004.61000000",
                "low": "2992.69000000",
                "close": "2993.19000000",
                "volume": "7961.88720000",
                "closeTime": 1715230799999,
                "quoteVolume": "23880228.18394100",
                "trades": 21077,
                "baseAssetVolume": "4097.16210000",
                "quoteAssetVolume": "12288130.70259400"
            },
            {
                "openTime": 1715230800000,
                "open": "2993.19000000",
                "high": "3014.96000000",
                "low": "2992.57000000",
                "close": "3004.25000000",
                "volume": "12133.48430000",
                "closeTime": 1715234399999,
                "quoteVolume": "36465297.98201400",
                "trades": 26242,
                "baseAssetVolume": "7965.16020000",
                "quoteAssetVolume": "23935393.50437200"
            },
            {
                "openTime": 1715234400000,
                "open": "3004.25000000",
                "high": "3013.04000000",
                "low": "2997.40000000",
                "close": "3001.00000000",
                "volume": "5902.99780000",
                "closeTime": 1715237999999,
                "quoteVolume": "17737945.37646500",
                "trades": 19622,
                "baseAssetVolume": "3131.42560000",
                "quoteAssetVolume": "9410164.94609100"
            },
            {
                "openTime": 1715238000000,
                "open": "3000.99000000",
                "high": "3002.00000000",
                "low": "2975.70000000",
                "close": "2983.59000000",
                "volume": "19324.69450000",
                "closeTime": 1715241599999,
                "quoteVolume": "57822692.76866400",
                "trades": 43735,
                "baseAssetVolume": "8270.25140000",
                "quoteAssetVolume": "24737486.66215500"
            },
            {
                "openTime": 1715241600000,
                "open": "2983.59000000",
                "high": "2991.80000000",
                "low": "2975.07000000",
                "close": "2984.81000000",
                "volume": "7137.93290000",
                "closeTime": 1715245199999,
                "quoteVolume": "21299298.65597200",
                "trades": 21636,
                "baseAssetVolume": "3760.30260000",
                "quoteAssetVolume": "11220737.93795300"
            },
            {
                "openTime": 1715245200000,
                "open": "2984.80000000",
                "high": "2986.99000000",
                "low": "2964.06000000",
                "close": "2982.54000000",
                "volume": "9874.81550000",
                "closeTime": 1715248799999,
                "quoteVolume": "29384391.92444900",
                "trades": 33557,
                "baseAssetVolume": "5002.61720000",
                "quoteAssetVolume": "14886640.30069100"
            },
            {
                "openTime": 1715248800000,
                "open": "2982.54000000",
                "high": "2984.33000000",
                "low": "2952.96000000",
                "close": "2955.19000000",
                "volume": "11440.50070000",
                "closeTime": 1715252399999,
                "quoteVolume": "33956953.20017300",
                "trades": 32579,
                "baseAssetVolume": "5119.26990000",
                "quoteAssetVolume": "15197442.67307800"
            },
            {
                "openTime": 1715252400000,
                "open": "2955.20000000",
                "high": "2985.19000000",
                "low": "2950.77000000",
                "close": "2977.20000000",
                "volume": "11177.37390000",
                "closeTime": 1715255999999,
                "quoteVolume": "33167115.31819900",
                "trades": 31051,
                "baseAssetVolume": "6226.31860000",
                "quoteAssetVolume": "18473372.46945400"
            },
            {
                "openTime": 1715256000000,
                "open": "2977.20000000",
                "high": "2998.21000000",
                "low": "2975.60000000",
                "close": "2988.15000000",
                "volume": "11378.74990000",
                "closeTime": 1715259599999,
                "quoteVolume": "33972426.86313900",
                "trades": 31045,
                "baseAssetVolume": "6833.78070000",
                "quoteAssetVolume": "20399153.21935000"
            },
            {
                "openTime": 1715259600000,
                "open": "2988.15000000",
                "high": "2990.19000000",
                "low": "2955.86000000",
                "close": "2973.61000000",
                "volume": "18369.20770000",
                "closeTime": 1715263199999,
                "quoteVolume": "54680086.15457100",
                "trades": 43124,
                "baseAssetVolume": "8491.64830000",
                "quoteAssetVolume": "25283894.77050500"
            },
            {
                "openTime": 1715263200000,
                "open": "2973.61000000",
                "high": "2989.30000000",
                "low": "2968.24000000",
                "close": "2987.20000000",
                "volume": "12528.94600000",
                "closeTime": 1715266799999,
                "quoteVolume": "37351253.55518100",
                "trades": 37246,
                "baseAssetVolume": "6868.17060000",
                "quoteAssetVolume": "20475460.16142600"
            },
            {
                "openTime": 1715266800000,
                "open": "2987.21000000",
                "high": "3019.28000000",
                "low": "2980.79000000",
                "close": "3005.99000000",
                "volume": "20229.53630000",
                "closeTime": 1715270399999,
                "quoteVolume": "60767955.56755600",
                "trades": 55755,
                "baseAssetVolume": "10306.43810000",
                "quoteAssetVolume": "30957639.96921200"
            },
            {
                "openTime": 1715270400000,
                "open": "3005.99000000",
                "high": "3025.98000000",
                "low": "2992.34000000",
                "close": "2994.61000000",
                "volume": "15148.47650000",
                "closeTime": 1715273999999,
                "quoteVolume": "45656698.00388500",
                "trades": 45196,
                "baseAssetVolume": "7154.35670000",
                "quoteAssetVolume": "21571743.63738400"
            },
            {
                "openTime": 1715274000000,
                "open": "2994.61000000",
                "high": "3012.26000000",
                "low": "2989.59000000",
                "close": "3003.80000000",
                "volume": "8126.02130000",
                "closeTime": 1715277599999,
                "quoteVolume": "24384572.94982500",
                "trades": 25756,
                "baseAssetVolume": "4190.84430000",
                "quoteAssetVolume": "12579224.56313100"
            },
            {
                "openTime": 1715277600000,
                "open": "3003.79000000",
                "high": "3016.80000000",
                "low": "3001.67000000",
                "close": "3016.80000000",
                "volume": "5172.59020000",
                "closeTime": 1715281199999,
                "quoteVolume": "15578412.92018200",
                "trades": 17602,
                "baseAssetVolume": "2907.73610000",
                "quoteAssetVolume": "8757169.27253200"
            },
            {
                "openTime": 1715281200000,
                "open": "3016.80000000",
                "high": "3023.78000000",
                "low": "3013.06000000",
                "close": "3021.41000000",
                "volume": "5692.85210000",
                "closeTime": 1715284799999,
                "quoteVolume": "17183151.28417900",
                "trades": 18516,
                "baseAssetVolume": "2891.48020000",
                "quoteAssetVolume": "8728185.47104100"
            },
            {
                "openTime": 1715284800000,
                "open": "3021.40000000",
                "high": "3029.18000000",
                "low": "3015.66000000",
                "close": "3021.80000000",
                "volume": "4841.22610000",
                "closeTime": 1715288399999,
                "quoteVolume": "14624936.17379200",
                "trades": 19316,
                "baseAssetVolume": "2285.46650000",
                "quoteAssetVolume": "6905083.61932600"
            },
            {
                "openTime": 1715288400000,
                "open": "3021.81000000",
                "high": "3029.85000000",
                "low": "3016.04000000",
                "close": "3020.39000000",
                "volume": "4375.93010000",
                "closeTime": 1715291999999,
                "quoteVolume": "13224573.42715600",
                "trades": 16598,
                "baseAssetVolume": "1642.48170000",
                "quoteAssetVolume": "4963896.81723700"
            },
            {
                "openTime": 1715292000000,
                "open": "3020.39000000",
                "high": "3059.00000000",
                "low": "3016.61000000",
                "close": "3054.34000000",
                "volume": "12498.02010000",
                "closeTime": 1715295599999,
                "quoteVolume": "38010185.15242100",
                "trades": 37263,
                "baseAssetVolume": "6980.43160000",
                "quoteAssetVolume": "21232597.57191200"
            },
            {
                "openTime": 1715295600000,
                "open": "3054.35000000",
                "high": "3055.60000000",
                "low": "3028.40000000",
                "close": "3036.23000000",
                "volume": "10438.75630000",
                "closeTime": 1715299199999,
                "quoteVolume": "31714651.99629300",
                "trades": 28736,
                "baseAssetVolume": "5236.92730000",
                "quoteAssetVolume": "15905780.57453600"
            },
            {
                "openTime": 1715299200000,
                "open": "3036.24000000",
                "high": "3037.39000000",
                "low": "3021.90000000",
                "close": "3026.00000000",
                "volume": "6840.96430000",
                "closeTime": 1715302799999,
                "quoteVolume": "20711495.29912400",
                "trades": 19514,
                "baseAssetVolume": "3589.76260000",
                "quoteAssetVolume": "10867537.15529800"
            },
            {
                "openTime": 1715302800000,
                "open": "3026.00000000",
                "high": "3031.01000000",
                "low": "3018.23000000",
                "close": "3027.35000000",
                "volume": "7283.68400000",
                "closeTime": 1715306399999,
                "quoteVolume": "22044526.65580000",
                "trades": 14474,
                "baseAssetVolume": "3612.29550000",
                "quoteAssetVolume": "10933011.15823500"
            },
            {
                "openTime": 1715306400000,
                "open": "3037.20000000",
                "high": "3037.21000000",
                "low": "3024.81000000",
                "close": "3030.84000000",
                "volume": "7006.21630000",
                "closeTime": 1715309999999,
                "quoteVolume": "21242545.88297900",
                "trades": 19670,
                "baseAssetVolume": "4274.06290000",
                "quoteAssetVolume": "12957347.70535700"
            },
            {
                "openTime": 1715310000000,
                "open": "3030.84000000",
                "high": "3030.84000000",
                "low": "3022.91000000",
                "close": "3028.95000000",
                "volume": "4527.85040000",
                "closeTime": 1715313599999,
                "quoteVolume": "13707777.10868500",
                "trades": 14095,
                "baseAssetVolume": "2165.46960000",
                "quoteAssetVolume": "6555753.60817800"
            },
            {
                "openTime": 1715313600000,
                "open": "3028.95000000",
                "high": "3033.82000000",
                "low": "3024.55000000",
                "close": "3031.59000000",
                "volume": "6532.67390000",
                "closeTime": 1715317199999,
                "quoteVolume": "19794290.89289400",
                "trades": 15588,
                "baseAssetVolume": "4148.52280000",
                "quoteAssetVolume": "12570557.63856300"
            },
            {
                "openTime": 1715317200000,
                "open": "3031.60000000",
                "high": "3033.78000000",
                "low": "3021.64000000",
                "close": "3029.80000000",
                "volume": "6927.13590000",
                "closeTime": 1715320799999,
                "quoteVolume": "20973541.03051200",
                "trades": 17765,
                "baseAssetVolume": "3777.75210000",
                "quoteAssetVolume": "11438748.43536200"
            },
            {
                "openTime": 1715320800000,
                "open": "3029.80000000",
                "high": "3049.79000000",
                "low": "3027.82000000",
                "close": "3046.59000000",
                "volume": "13572.77660000",
                "closeTime": 1715324399999,
                "quoteVolume": "41239310.21358100",
                "trades": 27181,
                "baseAssetVolume": "7650.53720000",
                "quoteAssetVolume": "23242995.85659700"
            },
            {
                "openTime": 1715324400000,
                "open": "3046.60000000",
                "high": "3053.89000000",
                "low": "3039.46000000",
                "close": "3047.79000000",
                "volume": "6363.60410000",
                "closeTime": 1715327999999,
                "quoteVolume": "19392667.99736200",
                "trades": 18060,
                "baseAssetVolume": "3374.72600000",
                "quoteAssetVolume": "10285252.23452300"
            },
            {
                "openTime": 1715328000000,
                "open": "3042.27000000",
                "high": "3045.23000000",
                "low": "3029.31000000",
                "close": "3036.99000000",
                "volume": "10710.59630000",
                "closeTime": 1715331599999,
                "quoteVolume": "32515074.21390900",
                "trades": 29013,
                "baseAssetVolume": "5060.79830000",
                "quoteAssetVolume": "15361845.36812600"
            },
            {
                "openTime": 1715331600000,
                "open": "3037.00000000",
                "high": "3037.00000000",
                "low": "3024.49000000",
                "close": "3033.18000000",
                "volume": "8273.89880000",
                "closeTime": 1715335199999,
                "quoteVolume": "25070330.53471300",
                "trades": 25100,
                "baseAssetVolume": "3209.59160000",
                "quoteAssetVolume": "9727716.43953900"
            },
            {
                "openTime": 1715335200000,
                "open": "3033.18000000",
                "high": "3035.07000000",
                "low": "3023.82000000",
                "close": "3029.95000000",
                "volume": "3812.10410000",
                "closeTime": 1715338799999,
                "quoteVolume": "11550418.60349500",
                "trades": 15766,
                "baseAssetVolume": "1888.29500000",
                "quoteAssetVolume": "5721466.47333700"
            },
            {
                "openTime": 1715338800000,
                "open": "3029.95000000",
                "high": "3038.94000000",
                "low": "3022.00000000",
                "close": "3037.85000000",
                "volume": "6651.92330000",
                "closeTime": 1715342399999,
                "quoteVolume": "20156085.39036400",
                "trades": 22394,
                "baseAssetVolume": "3232.44550000",
                "quoteAssetVolume": "9796378.75289600"
            },
            {
                "openTime": 1715342400000,
                "open": "3037.85000000",
                "high": "3044.53000000",
                "low": "3023.10000000",
                "close": "3028.00000000",
                "volume": "6526.51270000",
                "closeTime": 1715345999999,
                "quoteVolume": "19803886.64731800",
                "trades": 24652,
                "baseAssetVolume": "2599.25620000",
                "quoteAssetVolume": "7885078.77676300"
            },
            {
                "openTime": 1715346000000,
                "open": "3028.00000000",
                "high": "3031.00000000",
                "low": "3016.54000000",
                "close": "3020.66000000",
                "volume": "6809.22070000",
                "closeTime": 1715349599999,
                "quoteVolume": "20586568.82778400",
                "trades": 24239,
                "baseAssetVolume": "3176.66030000",
                "quoteAssetVolume": "9604321.18258200"
            },
            {
                "openTime": 1715349600000,
                "open": "3020.65000000",
                "high": "3025.05000000",
                "low": "2924.18000000",
                "close": "2935.78000000",
                "volume": "62539.36090000",
                "closeTime": 1715353199999,
                "quoteVolume": "185365865.74332800",
                "trades": 125606,
                "baseAssetVolume": "27593.14640000",
                "quoteAssetVolume": "81780674.94520600"
            },
            {
                "openTime": 1715353200000,
                "open": "2935.79000000",
                "high": "2946.11000000",
                "low": "2907.79000000",
                "close": "2918.54000000",
                "volume": "36829.56050000",
                "closeTime": 1715356799999,
                "quoteVolume": "107876627.09524200",
                "trades": 95167,
                "baseAssetVolume": "15991.86720000",
                "quoteAssetVolume": "46843340.35322900"
            },
            {
                "openTime": 1715356800000,
                "open": "2918.54000000",
                "high": "2935.00000000",
                "low": "2888.47000000",
                "close": "2921.70000000",
                "volume": "36631.09020000",
                "closeTime": 1715360399999,
                "quoteVolume": "106750141.11803100",
                "trades": 94520,
                "baseAssetVolume": "15814.49910000",
                "quoteAssetVolume": "46097208.63505000"
            },
            {
                "openTime": 1715360400000,
                "open": "2921.71000000",
                "high": "2921.71000000",
                "low": "2878.03000000",
                "close": "2892.77000000",
                "volume": "27946.45000000",
                "closeTime": 1715363999999,
                "quoteVolume": "80961776.18673100",
                "trades": 74394,
                "baseAssetVolume": "12877.65990000",
                "quoteAssetVolume": "37308053.75757700"
            },
            {
                "openTime": 1715364000000,
                "open": "2892.77000000",
                "high": "2909.40000000",
                "low": "2885.40000000",
                "close": "2907.64000000",
                "volume": "11597.50090000",
                "closeTime": 1715367599999,
                "quoteVolume": "33618066.94381500",
                "trades": 49235,
                "baseAssetVolume": "6090.02440000",
                "quoteAssetVolume": "17653488.58313800"
            },
            {
                "openTime": 1715367600000,
                "open": "2907.63000000",
                "high": "2916.55000000",
                "low": "2897.39000000",
                "close": "2901.60000000",
                "volume": "7866.61960000",
                "closeTime": 1715371199999,
                "quoteVolume": "22862376.93532300",
                "trades": 33793,
                "baseAssetVolume": "3337.78770000",
                "quoteAssetVolume": "9700930.54457400"
            },
            {
                "openTime": 1715371200000,
                "open": "2901.60000000",
                "high": "2912.59000000",
                "low": "2888.19000000",
                "close": "2893.37000000",
                "volume": "7220.03580000",
                "closeTime": 1715374799999,
                "quoteVolume": "20930004.53184600",
                "trades": 30456,
                "baseAssetVolume": "3199.71940000",
                "quoteAssetVolume": "9278484.55048000"
            },
            {
                "openTime": 1715374800000,
                "open": "2893.36000000",
                "high": "2906.53000000",
                "low": "2887.40000000",
                "close": "2906.52000000",
                "volume": "7038.10680000",
                "closeTime": 1715378399999,
                "quoteVolume": "20390204.26917600",
                "trades": 22874,
                "baseAssetVolume": "3633.87040000",
                "quoteAssetVolume": "10528582.28868800"
            },
            {
                "openTime": 1715378400000,
                "open": "2906.52000000",
                "high": "2910.40000000",
                "low": "2896.55000000",
                "close": "2905.56000000",
                "volume": "6617.90390000",
                "closeTime": 1715381999999,
                "quoteVolume": "19216725.89860000",
                "trades": 25336,
                "baseAssetVolume": "2930.73440000",
                "quoteAssetVolume": "8510750.92283200"
            },
            {
                "openTime": 1715382000000,
                "open": "2905.56000000",
                "high": "2914.20000000",
                "low": "2905.18000000",
                "close": "2913.19000000",
                "volume": "2835.04560000",
                "closeTime": 1715385599999,
                "quoteVolume": "8252724.12591700",
                "trades": 10785,
                "baseAssetVolume": "1441.73300000",
                "quoteAssetVolume": "4196485.30712700"
            },
            {
                "openTime": 1715385600000,
                "open": "2909.98000000",
                "high": "2920.00000000",
                "low": "2907.61000000",
                "close": "2914.46000000",
                "volume": "7043.49870000",
                "closeTime": 1715389199999,
                "quoteVolume": "20526557.80916500",
                "trades": 21461,
                "baseAssetVolume": "3832.56060000",
                "quoteAssetVolume": "11170127.92450200"
            },
            {
                "openTime": 1715389200000,
                "open": "2914.45000000",
                "high": "2936.59000000",
                "low": "2913.93000000",
                "close": "2919.49000000",
                "volume": "10169.92300000",
                "closeTime": 1715392799999,
                "quoteVolume": "29738265.82715300",
                "trades": 27176,
                "baseAssetVolume": "5226.44500000",
                "quoteAssetVolume": "15284306.69978800"
            },
            {
                "openTime": 1715392800000,
                "open": "2919.50000000",
                "high": "2924.66000000",
                "low": "2912.23000000",
                "close": "2918.79000000",
                "volume": "6128.20510000",
                "closeTime": 1715396399999,
                "quoteVolume": "17879324.84351400",
                "trades": 16865,
                "baseAssetVolume": "2905.98430000",
                "quoteAssetVolume": "8479016.50526200"
            },
            {
                "openTime": 1715396400000,
                "open": "2918.80000000",
                "high": "2919.91000000",
                "low": "2905.20000000",
                "close": "2911.00000000",
                "volume": "4354.82760000",
                "closeTime": 1715399999999,
                "quoteVolume": "12685200.02029700",
                "trades": 15188,
                "baseAssetVolume": "2075.87700000",
                "quoteAssetVolume": "6047266.36796600"
            },
            {
                "openTime": 1715400000000,
                "open": "2911.00000000",
                "high": "2916.16000000",
                "low": "2905.90000000",
                "close": "2913.01000000",
                "volume": "4009.06170000",
                "closeTime": 1715403599999,
                "quoteVolume": "11671119.33731800",
                "trades": 15344,
                "baseAssetVolume": "1797.87940000",
                "quoteAssetVolume": "5234484.34523400"
            },
            {
                "openTime": 1715403600000,
                "open": "2913.00000000",
                "high": "2922.69000000",
                "low": "2913.00000000",
                "close": "2918.86000000",
                "volume": "3593.53950000",
                "closeTime": 1715407199999,
                "quoteVolume": "10486992.73128500",
                "trades": 13529,
                "baseAssetVolume": "2293.65630000",
                "quoteAssetVolume": "6693355.17099100"
            },
            {
                "openTime": 1715407200000,
                "open": "2918.85000000",
                "high": "2927.74000000",
                "low": "2916.33000000",
                "close": "2920.27000000",
                "volume": "4891.32660000",
                "closeTime": 1715410799999,
                "quoteVolume": "14290668.55499100",
                "trades": 16302,
                "baseAssetVolume": "2499.64030000",
                "quoteAssetVolume": "7303989.64257300"
            },
            {
                "openTime": 1715410800000,
                "open": "2920.27000000",
                "high": "2924.59000000",
                "low": "2915.13000000",
                "close": "2921.79000000",
                "volume": "4569.59270000",
                "closeTime": 1715414399999,
                "quoteVolume": "13347099.70752000",
                "trades": 14835,
                "baseAssetVolume": "2319.90640000",
                "quoteAssetVolume": "6776161.19928600"
            },
            {
                "openTime": 1715414400000,
                "open": "2921.80000000",
                "high": "2925.38000000",
                "low": "2909.84000000",
                "close": "2910.56000000",
                "volume": "7823.03580000",
                "closeTime": 1715417999999,
                "quoteVolume": "22807211.46577300",
                "trades": 20038,
                "baseAssetVolume": "3809.96260000",
                "quoteAssetVolume": "11107224.03751100"
            },
            {
                "openTime": 1715418000000,
                "open": "2910.56000000",
                "high": "2911.88000000",
                "low": "2897.73000000",
                "close": "2911.28000000",
                "volume": "8221.11800000",
                "closeTime": 1715421599999,
                "quoteVolume": "23880560.98119600",
                "trades": 25273,
                "baseAssetVolume": "4020.06900000",
                "quoteAssetVolume": "11679586.08957800"
            },
            {
                "openTime": 1715421600000,
                "open": "2911.29000000",
                "high": "2911.43000000",
                "low": "2900.00000000",
                "close": "2906.88000000",
                "volume": "2985.85470000",
                "closeTime": 1715425199999,
                "quoteVolume": "8679679.88191000",
                "trades": 14863,
                "baseAssetVolume": "1535.39430000",
                "quoteAssetVolume": "4463455.68481700"
            },
            {
                "openTime": 1715425200000,
                "open": "2906.87000000",
                "high": "2910.25000000",
                "low": "2886.46000000",
                "close": "2903.40000000",
                "volume": "7241.94150000",
                "closeTime": 1715428799999,
                "quoteVolume": "20995861.98190800",
                "trades": 27248,
                "baseAssetVolume": "3262.28370000",
                "quoteAssetVolume": "9458847.00502700"
            },
            {
                "openTime": 1715428800000,
                "open": "2903.40000000",
                "high": "2910.52000000",
                "low": "2897.75000000",
                "close": "2900.19000000",
                "volume": "4567.61630000",
                "closeTime": 1715432399999,
                "quoteVolume": "13263936.02070900",
                "trades": 17075,
                "baseAssetVolume": "2308.31920000",
                "quoteAssetVolume": "6702907.11971900"
            },
            {
                "openTime": 1715432400000,
                "open": "2900.20000000",
                "high": "2916.44000000",
                "low": "2896.00000000",
                "close": "2913.84000000",
                "volume": "5888.88310000",
                "closeTime": 1715435999999,
                "quoteVolume": "17123145.19047100",
                "trades": 21778,
                "baseAssetVolume": "3131.41560000",
                "quoteAssetVolume": "9106413.37823300"
            },
            {
                "openTime": 1715436000000,
                "open": "2913.84000000",
                "high": "2915.15000000",
                "low": "2900.62000000",
                "close": "2902.34000000",
                "volume": "6349.33280000",
                "closeTime": 1715439599999,
                "quoteVolume": "18461045.54492000",
                "trades": 19866,
                "baseAssetVolume": "2397.88920000",
                "quoteAssetVolume": "6970088.40822500"
            },
            {
                "openTime": 1715439600000,
                "open": "2902.33000000",
                "high": "2945.67000000",
                "low": "2902.33000000",
                "close": "2925.72000000",
                "volume": "18000.10780000",
                "closeTime": 1715443199999,
                "quoteVolume": "52690336.25073500",
                "trades": 54496,
                "baseAssetVolume": "10369.30260000",
                "quoteAssetVolume": "30349290.53595500"
            },
            {
                "openTime": 1715443200000,
                "open": "2925.72000000",
                "high": "2931.72000000",
                "low": "2917.43000000",
                "close": "2924.45000000",
                "volume": "5526.71700000",
                "closeTime": 1715446799999,
                "quoteVolume": "16165845.51195800",
                "trades": 22064,
                "baseAssetVolume": "2473.09760000",
                "quoteAssetVolume": "7234597.38070300"
            },
            {
                "openTime": 1715446800000,
                "open": "2924.46000000",
                "high": "2932.44000000",
                "low": "2918.40000000",
                "close": "2930.28000000",
                "volume": "4175.14780000",
                "closeTime": 1715450399999,
                "quoteVolume": "12214325.02687800",
                "trades": 18250,
                "baseAssetVolume": "2229.79960000",
                "quoteAssetVolume": "6523570.79944900"
            },
            {
                "openTime": 1715450400000,
                "open": "2930.27000000",
                "high": "2940.37000000",
                "low": "2923.06000000",
                "close": "2932.79000000",
                "volume": "4509.43270000",
                "closeTime": 1715453999999,
                "quoteVolume": "13219128.55067900",
                "trades": 18268,
                "baseAssetVolume": "2387.47760000",
                "quoteAssetVolume": "6999690.26847700"
            },
            {
                "openTime": 1715454000000,
                "open": "2932.79000000",
                "high": "2933.61000000",
                "low": "2925.60000000",
                "close": "2930.61000000",
                "volume": "1780.11410000",
                "closeTime": 1715457599999,
                "quoteVolume": "5214297.26687800",
                "trades": 11210,
                "baseAssetVolume": "853.64220000",
                "quoteAssetVolume": "2500586.57523000"
            },
            {
                "openTime": 1715457600000,
                "open": "2930.61000000",
                "high": "2930.96000000",
                "low": "2912.41000000",
                "close": "2922.84000000",
                "volume": "4705.91770000",
                "closeTime": 1715461199999,
                "quoteVolume": "13743166.55082000",
                "trades": 18396,
                "baseAssetVolume": "2035.62490000",
                "quoteAssetVolume": "5945665.83313300"
            },
            {
                "openTime": 1715461200000,
                "open": "2922.84000000",
                "high": "2922.85000000",
                "low": "2915.85000000",
                "close": "2918.76000000",
                "volume": "2071.37400000",
                "closeTime": 1715464799999,
                "quoteVolume": "6046781.64903300",
                "trades": 10579,
                "baseAssetVolume": "976.53880000",
                "quoteAssetVolume": "2850739.24038100"
            },
            {
                "openTime": 1715464800000,
                "open": "2918.75000000",
                "high": "2921.98000000",
                "low": "2915.60000000",
                "close": "2915.99000000",
                "volume": "3968.91210000",
                "closeTime": 1715468399999,
                "quoteVolume": "11579700.98682700",
                "trades": 11759,
                "baseAssetVolume": "1637.88610000",
                "quoteAssetVolume": "4778855.57022900"
            },
            {
                "openTime": 1715468400000,
                "open": "2915.99000000",
                "high": "2919.59000000",
                "low": "2906.48000000",
                "close": "2912.45000000",
                "volume": "5587.62840000",
                "closeTime": 1715471999999,
                "quoteVolume": "16278813.87429100",
                "trades": 14494,
                "baseAssetVolume": "2286.57010000",
                "quoteAssetVolume": "6661910.88743200"
            },
            {
                "openTime": 1715472000000,
                "open": "2912.45000000",
                "high": "2925.33000000",
                "low": "2911.20000000",
                "close": "2920.75000000",
                "volume": "3462.91430000",
                "closeTime": 1715475599999,
                "quoteVolume": "10111083.05646700",
                "trades": 13193,
                "baseAssetVolume": "1935.98900000",
                "quoteAssetVolume": "5652393.73709100"
            },
            {
                "openTime": 1715475600000,
                "open": "2920.74000000",
                "high": "2924.98000000",
                "low": "2912.21000000",
                "close": "2912.51000000",
                "volume": "1866.89600000",
                "closeTime": 1715479199999,
                "quoteVolume": "5446140.44342400",
                "trades": 10286,
                "baseAssetVolume": "706.56570000",
                "quoteAssetVolume": "2061276.02607200"
            },
            {
                "openTime": 1715479200000,
                "open": "2912.51000000",
                "high": "2916.19000000",
                "low": "2909.11000000",
                "close": "2913.67000000",
                "volume": "1441.86130000",
                "closeTime": 1715482799999,
                "quoteVolume": "4199850.40055500",
                "trades": 6008,
                "baseAssetVolume": "662.03180000",
                "quoteAssetVolume": "1928310.17776100"
            },
            {
                "openTime": 1715482800000,
                "open": "2919.59000000",
                "high": "2923.40000000",
                "low": "2916.45000000",
                "close": "2921.13000000",
                "volume": "2753.19770000",
                "closeTime": 1715486399999,
                "quoteVolume": "8037626.11784200",
                "trades": 10708,
                "baseAssetVolume": "1549.30920000",
                "quoteAssetVolume": "4523145.17883200"
            },
            {
                "openTime": 1715486400000,
                "open": "2921.12000000",
                "high": "2932.26000000",
                "low": "2920.60000000",
                "close": "2928.82000000",
                "volume": "3096.66650000",
                "closeTime": 1715489999999,
                "quoteVolume": "9064097.12156300",
                "trades": 11946,
                "baseAssetVolume": "1718.66650000",
                "quoteAssetVolume": "5030373.95083800"
            },
            {
                "openTime": 1715490000000,
                "open": "2928.82000000",
                "high": "2928.97000000",
                "low": "2922.89000000",
                "close": "2925.93000000",
                "volume": "2155.33650000",
                "closeTime": 1715493599999,
                "quoteVolume": "6305190.52011900",
                "trades": 9728,
                "baseAssetVolume": "784.93940000",
                "quoteAssetVolume": "2296317.46919200"
            },
            {
                "openTime": 1715493600000,
                "open": "2925.94000000",
                "high": "2927.20000000",
                "low": "2917.33000000",
                "close": "2919.75000000",
                "volume": "2646.15940000",
                "closeTime": 1715497199999,
                "quoteVolume": "7731206.12407600",
                "trades": 11924,
                "baseAssetVolume": "865.96630000",
                "quoteAssetVolume": "2529977.85618000"
            },
            {
                "openTime": 1715497200000,
                "open": "2919.74000000",
                "high": "2922.28000000",
                "low": "2901.17000000",
                "close": "2908.02000000",
                "volume": "4880.16140000",
                "closeTime": 1715500799999,
                "quoteVolume": "14201691.15722600",
                "trades": 17695,
                "baseAssetVolume": "1800.00580000",
                "quoteAssetVolume": "5236965.50760800"
            },
            {
                "openTime": 1715500800000,
                "open": "2907.80000000",
                "high": "2918.12000000",
                "low": "2902.68000000",
                "close": "2915.80000000",
                "volume": "4718.75310000",
                "closeTime": 1715504399999,
                "quoteVolume": "13734545.92761600",
                "trades": 17857,
                "baseAssetVolume": "2551.48870000",
                "quoteAssetVolume": "7426343.52104700"
            },
            {
                "openTime": 1715504400000,
                "open": "2915.79000000",
                "high": "2918.15000000",
                "low": "2910.00000000",
                "close": "2915.69000000",
                "volume": "4019.81300000",
                "closeTime": 1715507999999,
                "quoteVolume": "11712636.69374800",
                "trades": 12455,
                "baseAssetVolume": "1974.40020000",
                "quoteAssetVolume": "5752798.10916400"
            },
            {
                "openTime": 1715508000000,
                "open": "2915.70000000",
                "high": "2943.73000000",
                "low": "2914.02000000",
                "close": "2930.63000000",
                "volume": "11027.90090000",
                "closeTime": 1715511599999,
                "quoteVolume": "32314550.14095200",
                "trades": 28913,
                "baseAssetVolume": "5694.84970000",
                "quoteAssetVolume": "16688075.74667800"
            },
            {
                "openTime": 1715511600000,
                "open": "2930.64000000",
                "high": "2934.20000000",
                "low": "2925.00000000",
                "close": "2928.00000000",
                "volume": "3078.78520000",
                "closeTime": 1715515199999,
                "quoteVolume": "9017832.67825000",
                "trades": 12896,
                "baseAssetVolume": "1414.53770000",
                "quoteAssetVolume": "4143642.28212200"
            },
            {
                "openTime": 1715515200000,
                "open": "2928.00000000",
                "high": "2934.20000000",
                "low": "2925.41000000",
                "close": "2929.70000000",
                "volume": "3958.73050000",
                "closeTime": 1715518799999,
                "quoteVolume": "11596613.75707300",
                "trades": 15231,
                "baseAssetVolume": "1738.83010000",
                "quoteAssetVolume": "5093700.55480800"
            },
            {
                "openTime": 1715518800000,
                "open": "2929.71000000",
                "high": "2937.98000000",
                "low": "2927.60000000",
                "close": "2936.20000000",
                "volume": "3810.10710000",
                "closeTime": 1715522399999,
                "quoteVolume": "11174601.66790700",
                "trades": 14091,
                "baseAssetVolume": "1858.13770000",
                "quoteAssetVolume": "5449078.47740800"
            },
            {
                "openTime": 1715522400000,
                "open": "2936.21000000",
                "high": "2939.57000000",
                "low": "2927.00000000",
                "close": "2929.53000000",
                "volume": "4748.02800000",
                "closeTime": 1715525999999,
                "quoteVolume": "13926518.90254900",
                "trades": 17047,
                "baseAssetVolume": "1905.17120000",
                "quoteAssetVolume": "5588150.83451000"
            },
            {
                "openTime": 1715526000000,
                "open": "2929.53000000",
                "high": "2943.77000000",
                "low": "2926.62000000",
                "close": "2938.00000000",
                "volume": "5714.45340000",
                "closeTime": 1715529599999,
                "quoteVolume": "16769702.81182100",
                "trades": 19631,
                "baseAssetVolume": "2916.58440000",
                "quoteAssetVolume": "8560224.41646100"
            },
            {
                "openTime": 1715529600000,
                "open": "2937.99000000",
                "high": "2955.20000000",
                "low": "2929.58000000",
                "close": "2929.59000000",
                "volume": "11529.75080000",
                "closeTime": 1715533199999,
                "quoteVolume": "33956450.25337300",
                "trades": 31140,
                "baseAssetVolume": "5014.34290000",
                "quoteAssetVolume": "14770444.55780600"
            },
            {
                "openTime": 1715533200000,
                "open": "2929.59000000",
                "high": "2943.20000000",
                "low": "2921.25000000",
                "close": "2941.61000000",
                "volume": "6925.54130000",
                "closeTime": 1715536799999,
                "quoteVolume": "20313952.39384600",
                "trades": 20872,
                "baseAssetVolume": "3187.70640000",
                "quoteAssetVolume": "9352073.07697800"
            },
            {
                "openTime": 1715536800000,
                "open": "2941.62000000",
                "high": "2941.80000000",
                "low": "2927.80000000",
                "close": "2929.01000000",
                "volume": "2647.95710000",
                "closeTime": 1715540399999,
                "quoteVolume": "7773650.23018500",
                "trades": 11368,
                "baseAssetVolume": "952.41570000",
                "quoteAssetVolume": "2795403.05476200"
            },
            {
                "openTime": 1715540400000,
                "open": "2929.00000000",
                "high": "2930.80000000",
                "low": "2921.62000000",
                "close": "2929.59000000",
                "volume": "3121.12640000",
                "closeTime": 1715543999999,
                "quoteVolume": "9133078.76045000",
                "trades": 12082,
                "baseAssetVolume": "1532.05770000",
                "quoteAssetVolume": "4482961.66482300"
            },
            {
                "openTime": 1715544000000,
                "open": "2929.60000000",
                "high": "2930.30000000",
                "low": "2923.06000000",
                "close": "2923.60000000",
                "volume": "2128.87320000",
                "closeTime": 1715547599999,
                "quoteVolume": "6230259.03568000",
                "trades": 9746,
                "baseAssetVolume": "846.07900000",
                "quoteAssetVolume": "2475974.87184100"
            },
            {
                "openTime": 1715547600000,
                "open": "2923.60000000",
                "high": "2934.23000000",
                "low": "2913.78000000",
                "close": "2929.32000000",
                "volume": "7093.42180000",
                "closeTime": 1715551199999,
                "quoteVolume": "20723172.34995500",
                "trades": 18620,
                "baseAssetVolume": "2286.60390000",
                "quoteAssetVolume": "6682972.14260400"
            },
            {
                "openTime": 1715551200000,
                "open": "2929.21000000",
                "high": "2934.60000000",
                "low": "2926.49000000",
                "close": "2931.97000000",
                "volume": "4645.66320000",
                "closeTime": 1715554799999,
                "quoteVolume": "13614911.72800200",
                "trades": 12476,
                "baseAssetVolume": "2087.08460000",
                "quoteAssetVolume": "6117412.63177700"
            },
            {
                "openTime": 1715554800000,
                "open": "2931.96000000",
                "high": "2936.27000000",
                "low": "2928.90000000",
                "close": "2929.29000000",
                "volume": "3238.38670000",
                "closeTime": 1715558399999,
                "quoteVolume": "9497932.83662200",
                "trades": 10954,
                "baseAssetVolume": "1286.05640000",
                "quoteAssetVolume": "3771711.21761300"
            },
            {
                "openTime": 1715558400000,
                "open": "2929.30000000",
                "high": "2942.97000000",
                "low": "2929.29000000",
                "close": "2932.91000000",
                "volume": "4546.29250000",
                "closeTime": 1715561999999,
                "quoteVolume": "13344392.21403100",
                "trades": 15350,
                "baseAssetVolume": "1773.34240000",
                "quoteAssetVolume": "5205540.21035800"
            },
            {
                "openTime": 1715562000000,
                "open": "2932.91000000",
                "high": "2935.40000000",
                "low": "2927.40000000",
                "close": "2928.07000000",
                "volume": "2031.40970000",
                "closeTime": 1715565599999,
                "quoteVolume": "5953968.56388200",
                "trades": 5728,
                "baseAssetVolume": "1072.09660000",
                "quoteAssetVolume": "3141826.75220200"
            },
            {
                "openTime": 1715565600000,
                "open": "2917.74000000",
                "high": "2923.28000000",
                "low": "2874.00000000",
                "close": "2885.35000000",
                "volume": "28524.27560000",
                "closeTime": 1715569199999,
                "quoteVolume": "82438245.39484500",
                "trades": 65531,
                "baseAssetVolume": "11410.49080000",
                "quoteAssetVolume": "32971603.84187700"
            },
            {
                "openTime": 1715569200000,
                "open": "2885.35000000",
                "high": "2890.65000000",
                "low": "2864.76000000",
                "close": "2889.92000000",
                "volume": "35381.22390000",
                "closeTime": 1715572799999,
                "quoteVolume": "101716048.18381500",
                "trades": 67606,
                "baseAssetVolume": "15024.63000000",
                "quoteAssetVolume": "43193242.00017600"
            },
            {
                "openTime": 1715572800000,
                "open": "2889.92000000",
                "high": "2889.93000000",
                "low": "2878.46000000",
                "close": "2885.75000000",
                "volume": "9801.61270000",
                "closeTime": 1715576399999,
                "quoteVolume": "28275388.69493800",
                "trades": 23657,
                "baseAssetVolume": "4553.51660000",
                "quoteAssetVolume": "13134468.93418600"
            },
            {
                "openTime": 1715576400000,
                "open": "2885.74000000",
                "high": "2894.25000000",
                "low": "2870.37000000",
                "close": "2875.42000000",
                "volume": "8407.84590000",
                "closeTime": 1715579999999,
                "quoteVolume": "24241038.13055500",
                "trades": 23547,
                "baseAssetVolume": "3364.92760000",
                "quoteAssetVolume": "9700117.74260300"
            },
            {
                "openTime": 1715580000000,
                "open": "2875.42000000",
                "high": "2922.66000000",
                "low": "2872.60000000",
                "close": "2919.19000000",
                "volume": "15514.45060000",
                "closeTime": 1715583599999,
                "quoteVolume": "45012816.80899400",
                "trades": 43026,
                "baseAssetVolume": "8816.22390000",
                "quoteAssetVolume": "25575269.93826100"
            },
            {
                "openTime": 1715583600000,
                "open": "2919.20000000",
                "high": "2958.00000000",
                "low": "2915.46000000",
                "close": "2953.99000000",
                "volume": "23266.70890000",
                "closeTime": 1715587199999,
                "quoteVolume": "68338356.68909800",
                "trades": 55081,
                "baseAssetVolume": "13123.30550000",
                "quoteAssetVolume": "38546778.77648800"
            },
            {
                "openTime": 1715587200000,
                "open": "2953.99000000",
                "high": "2979.21000000",
                "low": "2953.99000000",
                "close": "2969.97000000",
                "volume": "16191.64470000",
                "closeTime": 1715590799999,
                "quoteVolume": "48092665.73058500",
                "trades": 34089,
                "baseAssetVolume": "8935.20800000",
                "quoteAssetVolume": "26536906.70743700"
            },
            {
                "openTime": 1715590800000,
                "open": "2972.97000000",
                "high": "2996.40000000",
                "low": "2972.96000000",
                "close": "2985.89000000",
                "volume": "12248.42910000",
                "closeTime": 1715594399999,
                "quoteVolume": "36550113.04343900",
                "trades": 37996,
                "baseAssetVolume": "6840.65040000",
                "quoteAssetVolume": "20412366.90458000"
            },
            {
                "openTime": 1715594400000,
                "open": "2985.88000000",
                "high": "2987.60000000",
                "low": "2948.40000000",
                "close": "2963.00000000",
                "volume": "14042.65770000",
                "closeTime": 1715597999999,
                "quoteVolume": "41651165.36436400",
                "trades": 47411,
                "baseAssetVolume": "6499.57350000",
                "quoteAssetVolume": "19275026.49608100"
            },
            {
                "openTime": 1715598000000,
                "open": "2963.00000000",
                "high": "2969.55000000",
                "low": "2954.38000000",
                "close": "2965.57000000",
                "volume": "7848.10570000",
                "closeTime": 1715601599999,
                "quoteVolume": "23247854.65719800",
                "trades": 29169,
                "baseAssetVolume": "4258.71760000",
                "quoteAssetVolume": "12616783.21942600"
            },
            {
                "openTime": 1715601600000,
                "open": "2965.57000000",
                "high": "2973.00000000",
                "low": "2954.83000000",
                "close": "2965.71000000",
                "volume": "16952.12190000",
                "closeTime": 1715605199999,
                "quoteVolume": "50261418.35203000",
                "trades": 46861,
                "baseAssetVolume": "7045.72900000",
                "quoteAssetVolume": "20892741.95281800"
            },
            {
                "openTime": 1715605200000,
                "open": "2965.72000000",
                "high": "2987.00000000",
                "low": "2962.03000000",
                "close": "2964.81000000",
                "volume": "24900.00710000",
                "closeTime": 1715608799999,
                "quoteVolume": "74040535.26325600",
                "trades": 60208,
                "baseAssetVolume": "15217.45700000",
                "quoteAssetVolume": "45246883.63381300"
            },
            {
                "openTime": 1715608800000,
                "open": "2964.81000000",
                "high": "2973.56000000",
                "low": "2949.26000000",
                "close": "2951.92000000",
                "volume": "30167.60540000",
                "closeTime": 1715612399999,
                "quoteVolume": "89392347.18937400",
                "trades": 60596,
                "baseAssetVolume": "16563.10920000",
                "quoteAssetVolume": "49082574.83468700"
            },
            {
                "openTime": 1715612400000,
                "open": "2951.93000000",
                "high": "2973.45000000",
                "low": "2950.00000000",
                "close": "2961.22000000",
                "volume": "15776.28870000",
                "closeTime": 1715615999999,
                "quoteVolume": "46698561.66385900",
                "trades": 35416,
                "baseAssetVolume": "9218.40100000",
                "quoteAssetVolume": "27285279.68130900"
            },
            {
                "openTime": 1715616000000,
                "open": "2961.21000000",
                "high": "2976.91000000",
                "low": "2954.52000000",
                "close": "2976.33000000",
                "volume": "19006.39000000",
                "closeTime": 1715619599999,
                "quoteVolume": "56397441.37989800",
                "trades": 41899,
                "baseAssetVolume": "12180.34070000",
                "quoteAssetVolume": "36136346.85581200"
            },
            {
                "openTime": 1715619600000,
                "open": "2976.33000000",
                "high": "2977.89000000",
                "low": "2935.20000000",
                "close": "2940.97000000",
                "volume": "16202.78550000",
                "closeTime": 1715623199999,
                "quoteVolume": "47768032.45452500",
                "trades": 37957,
                "baseAssetVolume": "7541.38620000",
                "quoteAssetVolume": "22232800.33856900"
            },
            {
                "openTime": 1715623200000,
                "open": "2940.96000000",
                "high": "2944.99000000",
                "low": "2928.66000000",
                "close": "2943.52000000",
                "volume": "8713.89230000",
                "closeTime": 1715626799999,
                "quoteVolume": "25596339.35137300",
                "trades": 24125,
                "baseAssetVolume": "3863.69170000",
                "quoteAssetVolume": "11351463.58071300"
            },
            {
                "openTime": 1715626800000,
                "open": "2943.51000000",
                "high": "2957.70000000",
                "low": "2943.31000000",
                "close": "2956.70000000",
                "volume": "7961.65880000",
                "closeTime": 1715630399999,
                "quoteVolume": "23504884.00262400",
                "trades": 24255,
                "baseAssetVolume": "4642.45450000",
                "quoteAssetVolume": "13705161.73284600"
            },
            {
                "openTime": 1715630400000,
                "open": "2956.69000000",
                "high": "2960.00000000",
                "low": "2950.60000000",
                "close": "2954.39000000",
                "volume": "4558.13650000",
                "closeTime": 1715633999999,
                "quoteVolume": "13465738.19987900",
                "trades": 17726,
                "baseAssetVolume": "2280.27480000",
                "quoteAssetVolume": "6736483.42236400"
            },
            {
                "openTime": 1715634000000,
                "open": "2954.40000000",
                "high": "2956.28000000",
                "low": "2944.74000000",
                "close": "2951.39000000",
                "volume": "3624.97070000",
                "closeTime": 1715637599999,
                "quoteVolume": "10699624.18019400",
                "trades": 13933,
                "baseAssetVolume": "1724.77530000",
                "quoteAssetVolume": "5090501.13052000"
            },
            {
                "openTime": 1715637600000,
                "open": "2951.39000000",
                "high": "2954.60000000",
                "low": "2938.00000000",
                "close": "2939.81000000",
                "volume": "7614.89420000",
                "closeTime": 1715641199999,
                "quoteVolume": "22431306.82089400",
                "trades": 18052,
                "baseAssetVolume": "3069.95720000",
                "quoteAssetVolume": "9043028.27539400"
            },
            {
                "openTime": 1715641200000,
                "open": "2940.28000000",
                "high": "2952.94000000",
                "low": "2940.27000000",
                "close": "2950.99000000",
                "volume": "4011.75210000",
                "closeTime": 1715644799999,
                "quoteVolume": "11827674.84500600",
                "trades": 16819,
                "baseAssetVolume": "2224.61980000",
                "quoteAssetVolume": "6558271.79095300"
            },
            {
                "openTime": 1715644800000,
                "open": "2950.99000000",
                "high": "2958.76000000",
                "low": "2937.51000000",
                "close": "2945.80000000",
                "volume": "8841.44490000",
                "closeTime": 1715648399999,
                "quoteVolume": "26067809.88841700",
                "trades": 20829,
                "baseAssetVolume": "4159.47320000",
                "quoteAssetVolume": "12266282.22762000"
            },
            {
                "openTime": 1715648400000,
                "open": "2945.80000000",
                "high": "2960.60000000",
                "low": "2938.16000000",
                "close": "2946.40000000",
                "volume": "7608.35560000",
                "closeTime": 1715651999999,
                "quoteVolume": "22436023.75127900",
                "trades": 19568,
                "baseAssetVolume": "4012.78060000",
                "quoteAssetVolume": "11831749.82077300"
            },
            {
                "openTime": 1715652000000,
                "open": "2946.39000000",
                "high": "2955.88000000",
                "low": "2938.51000000",
                "close": "2949.18000000",
                "volume": "7903.66940000",
                "closeTime": 1715655599999,
                "quoteVolume": "23300963.52950100",
                "trades": 18315,
                "baseAssetVolume": "3530.72540000",
                "quoteAssetVolume": "10407334.62398200"
            },
            {
                "openTime": 1715655600000,
                "open": "2949.18000000",
                "high": "2956.81000000",
                "low": "2936.66000000",
                "close": "2940.99000000",
                "volume": "5395.59510000",
                "closeTime": 1715659199999,
                "quoteVolume": "15896558.40884100",
                "trades": 15239,
                "baseAssetVolume": "2137.55610000",
                "quoteAssetVolume": "6298289.12946700"
            },
            {
                "openTime": 1715659200000,
                "open": "2940.99000000",
                "high": "2947.62000000",
                "low": "2931.01000000",
                "close": "2937.29000000",
                "volume": "5061.27120000",
                "closeTime": 1715662799999,
                "quoteVolume": "14876617.24025500",
                "trades": 14300,
                "baseAssetVolume": "2411.97310000",
                "quoteAssetVolume": "7089639.92684700"
            },
            {
                "openTime": 1715662800000,
                "open": "2937.29000000",
                "high": "2949.07000000",
                "low": "2936.00000000",
                "close": "2942.69000000",
                "volume": "4078.40470000",
                "closeTime": 1715666399999,
                "quoteVolume": "12002500.50492000",
                "trades": 12870,
                "baseAssetVolume": "2166.74140000",
                "quoteAssetVolume": "6375651.76371600"
            },
            {
                "openTime": 1715666400000,
                "open": "2942.69000000",
                "high": "2942.69000000",
                "low": "2882.29000000",
                "close": "2916.03000000",
                "volume": "28100.93640000",
                "closeTime": 1715669999999,
                "quoteVolume": "81668431.18154900",
                "trades": 60114,
                "baseAssetVolume": "12988.78640000",
                "quoteAssetVolume": "37746578.22765700"
            },
            {
                "openTime": 1715670000000,
                "open": "2916.04000000",
                "high": "2920.60000000",
                "low": "2913.06000000",
                "close": "2920.03000000",
                "volume": "8258.71810000",
                "closeTime": 1715673599999,
                "quoteVolume": "24092118.92742700",
                "trades": 20367,
                "baseAssetVolume": "4027.70650000",
                "quoteAssetVolume": "11749268.16518200"
            },
            {
                "openTime": 1715673600000,
                "open": "2920.02000000",
                "high": "2920.03000000",
                "low": "2905.84000000",
                "close": "2914.06000000",
                "volume": "7522.16180000",
                "closeTime": 1715677199999,
                "quoteVolume": "21920753.57558600",
                "trades": 19382,
                "baseAssetVolume": "3237.89210000",
                "quoteAssetVolume": "9435571.15647000"
            },
            {
                "openTime": 1715677200000,
                "open": "2914.06000000",
                "high": "2918.58000000",
                "low": "2906.49000000",
                "close": "2912.59000000",
                "volume": "4880.00590000",
                "closeTime": 1715680799999,
                "quoteVolume": "14213466.02766100",
                "trades": 15995,
                "baseAssetVolume": "2480.59260000",
                "quoteAssetVolume": "7224671.57510300"
            },
            {
                "openTime": 1715680800000,
                "open": "2912.60000000",
                "high": "2914.67000000",
                "low": "2897.53000000",
                "close": "2903.92000000",
                "volume": "7753.80790000",
                "closeTime": 1715684399999,
                "quoteVolume": "22531052.82214900",
                "trades": 19882,
                "baseAssetVolume": "3808.81830000",
                "quoteAssetVolume": "11067780.11671600"
            },
            {
                "openTime": 1715684400000,
                "open": "2903.92000000",
                "high": "2912.61000000",
                "low": "2903.10000000",
                "close": "2907.94000000",
                "volume": "3940.73950000",
                "closeTime": 1715687999999,
                "quoteVolume": "11462735.52031800",
                "trades": 14887,
                "baseAssetVolume": "1917.39420000",
                "quoteAssetVolume": "5576737.73071200"
            },
            {
                "openTime": 1715688000000,
                "open": "2907.94000000",
                "high": "2920.00000000",
                "low": "2887.92000000",
                "close": "2894.61000000",
                "volume": "27329.40710000",
                "closeTime": 1715691599999,
                "quoteVolume": "79305546.48815800",
                "trades": 52343,
                "baseAssetVolume": "13217.02430000",
                "quoteAssetVolume": "38353692.69874000"
            },
            {
                "openTime": 1715691600000,
                "open": "2894.60000000",
                "high": "2912.43000000",
                "low": "2889.57000000",
                "close": "2896.78000000",
                "volume": "13024.93510000",
                "closeTime": 1715695199999,
                "quoteVolume": "37804470.10686800",
                "trades": 32762,
                "baseAssetVolume": "6516.59140000",
                "quoteAssetVolume": "18913319.14690800"
            },
            {
                "openTime": 1715695200000,
                "open": "2896.79000000",
                "high": "2924.14000000",
                "low": "2870.25000000",
                "close": "2894.30000000",
                "volume": "46163.66810000",
                "closeTime": 1715698799999,
                "quoteVolume": "133609356.00853800",
                "trades": 81315,
                "baseAssetVolume": "22972.76550000",
                "quoteAssetVolume": "66499397.29169000"
            },
            {
                "openTime": 1715698800000,
                "open": "2894.29000000",
                "high": "2915.94000000",
                "low": "2887.29000000",
                "close": "2898.93000000",
                "volume": "23456.16170000",
                "closeTime": 1715702399999,
                "quoteVolume": "68052512.81463500",
                "trades": 41169,
                "baseAssetVolume": "14325.92040000",
                "quoteAssetVolume": "41557789.11687500"
            },
            {
                "openTime": 1715702400000,
                "open": "2898.94000000",
                "high": "2900.67000000",
                "low": "2884.82000000",
                "close": "2892.88000000",
                "volume": "10511.51750000",
                "closeTime": 1715705999999,
                "quoteVolume": "30385212.18344400",
                "trades": 27409,
                "baseAssetVolume": "4845.72810000",
                "quoteAssetVolume": "14007994.39557100"
            },
            {
                "openTime": 1715706000000,
                "open": "2892.88000000",
                "high": "2894.95000000",
                "low": "2862.00000000",
                "close": "2876.07000000",
                "volume": "17010.09700000",
                "closeTime": 1715709599999,
                "quoteVolume": "48951651.94477500",
                "trades": 37339,
                "baseAssetVolume": "7189.84230000",
                "quoteAssetVolume": "20689981.32829300"
            },
            {
                "openTime": 1715709600000,
                "open": "2876.06000000",
                "high": "2890.42000000",
                "low": "2870.86000000",
                "close": "2887.57000000",
                "volume": "6610.19040000",
                "closeTime": 1715713199999,
                "quoteVolume": "19048638.26044900",
                "trades": 18206,
                "baseAssetVolume": "3243.88020000",
                "quoteAssetVolume": "9349472.11548600"
            },
            {
                "openTime": 1715713200000,
                "open": "2887.58000000",
                "high": "2897.85000000",
                "low": "2886.21000000",
                "close": "2893.74000000",
                "volume": "6005.91440000",
                "closeTime": 1715716799999,
                "quoteVolume": "17375455.29001500",
                "trades": 16069,
                "baseAssetVolume": "3233.96660000",
                "quoteAssetVolume": "9356053.11197300"
            },
            {
                "openTime": 1715716800000,
                "open": "2893.73000000",
                "high": "2900.71000000",
                "low": "2888.01000000",
                "close": "2892.50000000",
                "volume": "6251.88420000",
                "closeTime": 1715720399999,
                "quoteVolume": "18095906.08262000",
                "trades": 16072,
                "baseAssetVolume": "3010.14180000",
                "quoteAssetVolume": "8713292.46990500"
            },
            {
                "openTime": 1715720400000,
                "open": "2892.51000000",
                "high": "2903.00000000",
                "low": "2887.50000000",
                "close": "2896.00000000",
                "volume": "4634.43470000",
                "closeTime": 1715723999999,
                "quoteVolume": "13413731.56995800",
                "trades": 14843,
                "baseAssetVolume": "2702.31080000",
                "quoteAssetVolume": "7821641.93547400"
            },
            {
                "openTime": 1715724000000,
                "open": "2895.99000000",
                "high": "2898.60000000",
                "low": "2893.64000000",
                "close": "2895.56000000",
                "volume": "1138.78130000",
                "closeTime": 1715727599999,
                "quoteVolume": "3298448.24177500",
                "trades": 3359,
                "baseAssetVolume": "645.73670000",
                "quoteAssetVolume": "1870249.48623600"
            },
            {
                "openTime": 1715727600000,
                "open": "2889.58000000",
                "high": "2890.78000000",
                "low": "2878.65000000",
                "close": "2881.93000000",
                "volume": "3990.60800000",
                "closeTime": 1715731199999,
                "quoteVolume": "11509239.78806600",
                "trades": 14461,
                "baseAssetVolume": "1986.96320000",
                "quoteAssetVolume": "5730540.18989900"
            },
            {
                "openTime": 1715731200000,
                "open": "2881.93000000",
                "high": "2894.99000000",
                "low": "2863.75000000",
                "close": "2869.59000000",
                "volume": "7442.26240000",
                "closeTime": 1715734799999,
                "quoteVolume": "21424905.51163300",
                "trades": 21511,
                "baseAssetVolume": "3451.88200000",
                "quoteAssetVolume": "9937530.88768700"
            },
            {
                "openTime": 1715734800000,
                "open": "2869.59000000",
                "high": "2886.45000000",
                "low": "2868.73000000",
                "close": "2885.43000000",
                "volume": "4405.58850000",
                "closeTime": 1715738399999,
                "quoteVolume": "12688000.87461800",
                "trades": 12381,
                "baseAssetVolume": "2270.87600000",
                "quoteAssetVolume": "6540904.54711400"
            },
            {
                "openTime": 1715738400000,
                "open": "2885.86000000",
                "high": "2893.53000000",
                "low": "2884.19000000",
                "close": "2888.39000000",
                "volume": "5335.90520000",
                "closeTime": 1715741999999,
                "quoteVolume": "15415144.35499800",
                "trades": 14431,
                "baseAssetVolume": "2663.05320000",
                "quoteAssetVolume": "7693159.20192600"
            },
            {
                "openTime": 1715742000000,
                "open": "2888.39000000",
                "high": "2903.08000000",
                "low": "2888.38000000",
                "close": "2902.64000000",
                "volume": "6360.45150000",
                "closeTime": 1715745599999,
                "quoteVolume": "18423493.18008900",
                "trades": 16866,
                "baseAssetVolume": "2839.26460000",
                "quoteAssetVolume": "8223708.22419700"
            },
            {
                "openTime": 1715745600000,
                "open": "2902.65000000",
                "high": "2904.73000000",
                "low": "2897.98000000",
                "close": "2903.81000000",
                "volume": "4157.35700000",
                "closeTime": 1715749199999,
                "quoteVolume": "12061744.71727400",
                "trades": 11863,
                "baseAssetVolume": "1991.77010000",
                "quoteAssetVolume": "5778407.14018700"
            },
            {
                "openTime": 1715749200000,
                "open": "2903.81000000",
                "high": "2913.22000000",
                "low": "2900.26000000",
                "close": "2906.98000000",
                "volume": "10504.65670000",
                "closeTime": 1715752799999,
                "quoteVolume": "30530029.15768000",
                "trades": 20482,
                "baseAssetVolume": "4691.69280000",
                "quoteAssetVolume": "13636324.32346200"
            },
            {
                "openTime": 1715752800000,
                "open": "2906.98000000",
                "high": "2910.60000000",
                "low": "2900.86000000",
                "close": "2906.15000000",
                "volume": "4854.65730000",
                "closeTime": 1715756399999,
                "quoteVolume": "14108191.86917600",
                "trades": 13836,
                "baseAssetVolume": "2442.93660000",
                "quoteAssetVolume": "7099733.98029100"
            },
            {
                "openTime": 1715756400000,
                "open": "2906.15000000",
                "high": "2922.00000000",
                "low": "2902.63000000",
                "close": "2916.51000000",
                "volume": "11966.00100000",
                "closeTime": 1715759999999,
                "quoteVolume": "34863526.89829500",
                "trades": 26852,
                "baseAssetVolume": "6998.26890000",
                "quoteAssetVolume": "20389916.37236200"
            },
            {
                "openTime": 1715760000000,
                "open": "2916.50000000",
                "high": "2919.00000000",
                "low": "2903.32000000",
                "close": "2905.21000000",
                "volume": "6767.99520000",
                "closeTime": 1715763599999,
                "quoteVolume": "19693446.43989600",
                "trades": 17132,
                "baseAssetVolume": "3388.97590000",
                "quoteAssetVolume": "9860270.90587000"
            },
            {
                "openTime": 1715763600000,
                "open": "2905.20000000",
                "high": "2905.80000000",
                "low": "2902.53000000",
                "close": "2904.80000000",
                "volume": "1116.90230000",
                "closeTime": 1715767199999,
                "quoteVolume": "3243500.53720500",
                "trades": 1531,
                "baseAssetVolume": "212.05660000",
                "quoteAssetVolume": "615960.47818300"
            },
            {
                "openTime": 1715767200000,
                "open": "2920.16000000",
                "high": "2923.76000000",
                "low": "2906.29000000",
                "close": "2907.28000000",
                "volume": "13941.62060000",
                "closeTime": 1715770799999,
                "quoteVolume": "40612272.75912400",
                "trades": 32070,
                "baseAssetVolume": "6653.62980000",
                "quoteAssetVolume": "19382960.22826500"
            },
            {
                "openTime": 1715770800000,
                "open": "2907.28000000",
                "high": "2908.79000000",
                "low": "2886.81000000",
                "close": "2898.74000000",
                "volume": "15547.91540000",
                "closeTime": 1715774399999,
                "quoteVolume": "45047620.04756900",
                "trades": 29932,
                "baseAssetVolume": "7003.12180000",
                "quoteAssetVolume": "20288426.47878900"
            },
            {
                "openTime": 1715774400000,
                "open": "2898.74000000",
                "high": "2958.70000000",
                "low": "2893.02000000",
                "close": "2947.35000000",
                "volume": "44690.67500000",
                "closeTime": 1715777999999,
                "quoteVolume": "131280530.01239400",
                "trades": 108251,
                "baseAssetVolume": "23010.97660000",
                "quoteAssetVolume": "67595530.11045500"
            },
            {
                "openTime": 1715778000000,
                "open": "2947.34000000",
                "high": "2982.00000000",
                "low": "2935.43000000",
                "close": "2950.48000000",
                "volume": "35917.88360000",
                "closeTime": 1715781599999,
                "quoteVolume": "106400371.99982700",
                "trades": 68697,
                "baseAssetVolume": "18892.50970000",
                "quoteAssetVolume": "55985384.86998200"
            },
            {
                "openTime": 1715781600000,
                "open": "2950.49000000",
                "high": "2976.66000000",
                "low": "2945.00000000",
                "close": "2976.08000000",
                "volume": "19583.54580000",
                "closeTime": 1715785199999,
                "quoteVolume": "58030097.26282900",
                "trades": 45080,
                "baseAssetVolume": "10104.80900000",
                "quoteAssetVolume": "29938039.32614900"
            },
            {
                "openTime": 1715785200000,
                "open": "2976.09000000",
                "high": "2992.99000000",
                "low": "2969.19000000",
                "close": "2976.81000000",
                "volume": "32677.71830000",
                "closeTime": 1715788799999,
                "quoteVolume": "97393282.63174300",
                "trades": 55124,
                "baseAssetVolume": "17596.86150000",
                "quoteAssetVolume": "52448590.96113300"
            },
            {
                "openTime": 1715788800000,
                "open": "2976.80000000",
                "high": "2989.73000000",
                "low": "2970.00000000",
                "close": "2974.18000000",
                "volume": "12435.79300000",
                "closeTime": 1715792399999,
                "quoteVolume": "37023926.80691000",
                "trades": 28699,
                "baseAssetVolume": "6050.19340000",
                "quoteAssetVolume": "18012638.11918800"
            },
            {
                "openTime": 1715792400000,
                "open": "2974.19000000",
                "high": "2989.98000000",
                "low": "2973.17000000",
                "close": "2983.45000000",
                "volume": "7088.49230000",
                "closeTime": 1715795999999,
                "quoteVolume": "21137295.31956500",
                "trades": 19710,
                "baseAssetVolume": "3683.46930000",
                "quoteAssetVolume": "10983381.81950400"
            },
            {
                "openTime": 1715796000000,
                "open": "2983.45000000",
                "high": "3008.63000000",
                "low": "2982.55000000",
                "close": "3003.56000000",
                "volume": "16626.87380000",
                "closeTime": 1715799599999,
                "quoteVolume": "49834999.55239300",
                "trades": 48436,
                "baseAssetVolume": "9709.68530000",
                "quoteAssetVolume": "29104491.04703800"
            },
            {
                "openTime": 1715799600000,
                "open": "3003.57000000",
                "high": "3025.96000000",
                "low": "2991.18000000",
                "close": "3024.56000000",
                "volume": "19664.49040000",
                "closeTime": 1715803199999,
                "quoteVolume": "59214030.31849600",
                "trades": 39367,
                "baseAssetVolume": "8770.37000000",
                "quoteAssetVolume": "26404743.49904500"
            },
            {
                "openTime": 1715803200000,
                "open": "3024.55000000",
                "high": "3029.00000000",
                "low": "3010.56000000",
                "close": "3021.27000000",
                "volume": "11879.66070000",
                "closeTime": 1715806799999,
                "quoteVolume": "35857751.61602800",
                "trades": 25337,
                "baseAssetVolume": "5408.88480000",
                "quoteAssetVolume": "16326170.07613900"
            },
            {
                "openTime": 1715806800000,
                "open": "3021.27000000",
                "high": "3023.52000000",
                "low": "3011.83000000",
                "close": "3013.45000000",
                "volume": "6759.90040000",
                "closeTime": 1715810399999,
                "quoteVolume": "20387974.16526300",
                "trades": 14715,
                "baseAssetVolume": "2934.42100000",
                "quoteAssetVolume": "8851093.12784200"
            },
            {
                "openTime": 1715810400000,
                "open": "3013.45000000",
                "high": "3022.73000000",
                "low": "3009.49000000",
                "close": "3013.35000000",
                "volume": "7222.62790000",
                "closeTime": 1715813999999,
                "quoteVolume": "21776541.28801200",
                "trades": 17783,
                "baseAssetVolume": "3560.69730000",
                "quoteAssetVolume": "10736230.38354800"
            },
            {
                "openTime": 1715814000000,
                "open": "3013.36000000",
                "high": "3041.36000000",
                "low": "3013.35000000",
                "close": "3039.72000000",
                "volume": "27741.58290000",
                "closeTime": 1715817599999,
                "quoteVolume": "84135971.03100100",
                "trades": 34091,
                "baseAssetVolume": "12936.92830000",
                "quoteAssetVolume": "39209395.08480000"
            },
            {
                "openTime": 1715817600000,
                "open": "3032.55000000",
                "high": "3041.24000000",
                "low": "3028.56000000",
                "close": "3032.34000000",
                "volume": "9518.67180000",
                "closeTime": 1715821199999,
                "quoteVolume": "28880914.05463400",
                "trades": 14221,
                "baseAssetVolume": "4161.16850000",
                "quoteAssetVolume": "12627547.74080000"
            },
            {
                "openTime": 1715821200000,
                "open": "3021.54000000",
                "high": "3024.58000000",
                "low": "3008.95000000",
                "close": "3014.99000000",
                "volume": "11328.55530000",
                "closeTime": 1715824799999,
                "quoteVolume": "34193747.11461100",
                "trades": 20122,
                "baseAssetVolume": "5584.49110000",
                "quoteAssetVolume": "16858938.61831100"
            },
            {
                "openTime": 1715824800000,
                "open": "3014.99000000",
                "high": "3016.79000000",
                "low": "2997.00000000",
                "close": "3003.80000000",
                "volume": "9052.59560000",
                "closeTime": 1715828399999,
                "quoteVolume": "27231769.88105400",
                "trades": 16798,
                "baseAssetVolume": "3701.11440000",
                "quoteAssetVolume": "11135333.84085100"
            },
            {
                "openTime": 1715828400000,
                "open": "3003.80000000",
                "high": "3018.55000000",
                "low": "2999.00000000",
                "close": "3013.44000000",
                "volume": "9958.98880000",
                "closeTime": 1715831999999,
                "quoteVolume": "29978841.93817900",
                "trades": 19342,
                "baseAssetVolume": "5571.25360000",
                "quoteAssetVolume": "16770663.82188400"
            },
            {
                "openTime": 1715832000000,
                "open": "3013.45000000",
                "high": "3014.89000000",
                "low": "3004.46000000",
                "close": "3008.05000000",
                "volume": "6500.97620000",
                "closeTime": 1715835599999,
                "quoteVolume": "19565963.17423300",
                "trades": 13595,
                "baseAssetVolume": "3071.08160000",
                "quoteAssetVolume": "9242447.28778800"
            },
            {
                "openTime": 1715835600000,
                "open": "3008.06000000",
                "high": "3010.65000000",
                "low": "3004.81000000",
                "close": "3006.48000000",
                "volume": "5948.44390000",
                "closeTime": 1715839199999,
                "quoteVolume": "17890100.96431600",
                "trades": 12936,
                "baseAssetVolume": "3574.99680000",
                "quoteAssetVolume": "10751472.80718300"
            },
            {
                "openTime": 1715839200000,
                "open": "3006.48000000",
                "high": "3019.55000000",
                "low": "3004.40000000",
                "close": "3015.46000000",
                "volume": "6659.71470000",
                "closeTime": 1715842799999,
                "quoteVolume": "20070752.86407600",
                "trades": 14258,
                "baseAssetVolume": "4036.76760000",
                "quoteAssetVolume": "12165069.72648000"
            },
            {
                "openTime": 1715842800000,
                "open": "3015.46000000",
                "high": "3021.37000000",
                "low": "3012.89000000",
                "close": "3016.31000000",
                "volume": "9543.30620000",
                "closeTime": 1715846399999,
                "quoteVolume": "28795554.68632600",
                "trades": 18191,
                "baseAssetVolume": "4797.84170000",
                "quoteAssetVolume": "14477612.09085500"
            },
            {
                "openTime": 1715846400000,
                "open": "3016.31000000",
                "high": "3027.85000000",
                "low": "3005.50000000",
                "close": "3009.19000000",
                "volume": "11475.61630000",
                "closeTime": 1715849999999,
                "quoteVolume": "34576560.28448300",
                "trades": 20350,
                "baseAssetVolume": "5475.17050000",
                "quoteAssetVolume": "16498260.18263000"
            },
            {
                "openTime": 1715850000000,
                "open": "3009.18000000",
                "high": "3010.00000000",
                "low": "2999.40000000",
                "close": "3010.00000000",
                "volume": "10276.53310000",
                "closeTime": 1715853599999,
                "quoteVolume": "30872214.15717300",
                "trades": 22509,
                "baseAssetVolume": "5249.12280000",
                "quoteAssetVolume": "15770459.67281000"
            },
            {
                "openTime": 1715853600000,
                "open": "3009.99000000",
                "high": "3010.40000000",
                "low": "2989.72000000",
                "close": "2998.31000000",
                "volume": "13675.44580000",
                "closeTime": 1715857199999,
                "quoteVolume": "41012627.92459500",
                "trades": 25026,
                "baseAssetVolume": "6203.86600000",
                "quoteAssetVolume": "18605475.61750700"
            },
            {
                "openTime": 1715857200000,
                "open": "2998.31000000",
                "high": "3009.20000000",
                "low": "2992.20000000",
                "close": "3006.45000000",
                "volume": "7755.41680000",
                "closeTime": 1715860799999,
                "quoteVolume": "23256312.73576900",
                "trades": 19045,
                "baseAssetVolume": "4100.49180000",
                "quoteAssetVolume": "12296078.11681000"
            },
            {
                "openTime": 1715860800000,
                "open": "3006.45000000",
                "high": "3009.12000000",
                "low": "2973.84000000",
                "close": "2980.00000000",
                "volume": "26479.00930000",
                "closeTime": 1715864399999,
                "quoteVolume": "79174623.24765300",
                "trades": 47602,
                "baseAssetVolume": "12055.61930000",
                "quoteAssetVolume": "36040816.49242300"
            },
            {
                "openTime": 1715864400000,
                "open": "2980.01000000",
                "high": "2987.87000000",
                "low": "2967.00000000",
                "close": "2983.14000000",
                "volume": "18564.93390000",
                "closeTime": 1715867999999,
                "quoteVolume": "55295438.20110400",
                "trades": 37257,
                "baseAssetVolume": "9694.65050000",
                "quoteAssetVolume": "28877563.12850500"
            },
            {
                "openTime": 1715868000000,
                "open": "2983.15000000",
                "high": "2987.27000000",
                "low": "2937.70000000",
                "close": "2941.27000000",
                "volume": "25846.50440000",
                "closeTime": 1715871599999,
                "quoteVolume": "76487268.62066400",
                "trades": 51690,
                "baseAssetVolume": "10801.60230000",
                "quoteAssetVolume": "31967518.70416100"
            },
            {
                "openTime": 1715871600000,
                "open": "2941.28000000",
                "high": "2961.70000000",
                "low": "2931.05000000",
                "close": "2956.57000000",
                "volume": "18371.36020000",
                "closeTime": 1715875199999,
                "quoteVolume": "54158533.04641300",
                "trades": 36861,
                "baseAssetVolume": "9081.11230000",
                "quoteAssetVolume": "26776611.79737100"
            },
            {
                "openTime": 1715875200000,
                "open": "2956.57000000",
                "high": "2960.64000000",
                "low": "2943.39000000",
                "close": "2946.62000000",
                "volume": "20053.48830000",
                "closeTime": 1715878799999,
                "quoteVolume": "59186487.48357000",
                "trades": 33534,
                "baseAssetVolume": "8562.55540000",
                "quoteAssetVolume": "25273085.60961100"
            },
            {
                "openTime": 1715878800000,
                "open": "2946.62000000",
                "high": "2952.42000000",
                "low": "2925.02000000",
                "close": "2947.24000000",
                "volume": "14508.88120000",
                "closeTime": 1715882399999,
                "quoteVolume": "42631366.88280100",
                "trades": 29331,
                "baseAssetVolume": "7109.01430000",
                "quoteAssetVolume": "20890652.95570100"
            },
            {
                "openTime": 1715882400000,
                "open": "2947.24000000",
                "high": "2953.89000000",
                "low": "2946.39000000",
                "close": "2947.20000000",
                "volume": "4462.13540000",
                "closeTime": 1715885999999,
                "quoteVolume": "13161153.14259800",
                "trades": 10579,
                "baseAssetVolume": "2347.05710000",
                "quoteAssetVolume": "6922998.46867200"
            },
            {
                "openTime": 1715886000000,
                "open": "2949.00000000",
                "high": "2956.17000000",
                "low": "2946.63000000",
                "close": "2949.60000000",
                "volume": "4341.61090000",
                "closeTime": 1715889599999,
                "quoteVolume": "12811579.22334900",
                "trades": 10145,
                "baseAssetVolume": "2404.81670000",
                "quoteAssetVolume": "7096408.38674500"
            },
            {
                "openTime": 1715889600000,
                "open": "2944.75000000",
                "high": "2945.93000000",
                "low": "2933.51000000",
                "close": "2937.37000000",
                "volume": "5444.62230000",
                "closeTime": 1715893199999,
                "quoteVolume": "16006675.24379200",
                "trades": 14439,
                "baseAssetVolume": "2425.98270000",
                "quoteAssetVolume": "7131810.56029200"
            },
            {
                "openTime": 1715893200000,
                "open": "2937.37000000",
                "high": "2941.44000000",
                "low": "2927.10000000",
                "close": "2940.59000000",
                "volume": "6267.34500000",
                "closeTime": 1715896799999,
                "quoteVolume": "18396673.26566400",
                "trades": 16375,
                "baseAssetVolume": "2928.33380000",
                "quoteAssetVolume": "8596514.15655400"
            },
            {
                "openTime": 1715896800000,
                "open": "2940.59000000",
                "high": "2940.80000000",
                "low": "2922.80000000",
                "close": "2928.69000000",
                "volume": "3324.18970000",
                "closeTime": 1715900399999,
                "quoteVolume": "9738904.97295400",
                "trades": 9656,
                "baseAssetVolume": "1110.11780000",
                "quoteAssetVolume": "3251520.99728400"
            },
            {
                "openTime": 1715900400000,
                "open": "2939.54000000",
                "high": "2946.10000000",
                "low": "2931.81000000",
                "close": "2944.70000000",
                "volume": "6541.90130000",
                "closeTime": 1715903999999,
                "quoteVolume": "19226643.86720800",
                "trades": 16230,
                "baseAssetVolume": "3655.89830000",
                "quoteAssetVolume": "10744168.64463900"
            },
            {
                "openTime": 1715904000000,
                "open": "2944.70000000",
                "high": "2948.88000000",
                "low": "2940.96000000",
                "close": "2948.80000000",
                "volume": "2244.14630000",
                "closeTime": 1715907599999,
                "quoteVolume": "6608541.98746300",
                "trades": 5522,
                "baseAssetVolume": "1025.83390000",
                "quoteAssetVolume": "3021270.45933800"
            },
            {
                "openTime": 1715907600000,
                "open": "2952.65000000",
                "high": "2952.99000000",
                "low": "2933.06000000",
                "close": "2945.27000000",
                "volume": "7558.06520000",
                "closeTime": 1715911199999,
                "quoteVolume": "22254283.31489000",
                "trades": 19840,
                "baseAssetVolume": "2679.05390000",
                "quoteAssetVolume": "7888523.31778500"
            },
            {
                "openTime": 1715911200000,
                "open": "2945.26000000",
                "high": "2956.03000000",
                "low": "2940.62000000",
                "close": "2950.21000000",
                "volume": "6386.99510000",
                "closeTime": 1715914799999,
                "quoteVolume": "18825774.57581400",
                "trades": 16757,
                "baseAssetVolume": "3767.58440000",
                "quoteAssetVolume": "11105486.33070300"
            },
            {
                "openTime": 1715914800000,
                "open": "2950.21000000",
                "high": "2956.28000000",
                "low": "2948.14000000",
                "close": "2950.49000000",
                "volume": "8279.96890000",
                "closeTime": 1715918399999,
                "quoteVolume": "24436788.57675400",
                "trades": 21435,
                "baseAssetVolume": "4337.88730000",
                "quoteAssetVolume": "12802567.20035200"
            },
            {
                "openTime": 1715918400000,
                "open": "2950.50000000",
                "high": "2957.00000000",
                "low": "2944.56000000",
                "close": "2945.32000000",
                "volume": "6333.57650000",
                "closeTime": 1715921999999,
                "quoteVolume": "18689764.87301800",
                "trades": 17780,
                "baseAssetVolume": "2690.27390000",
                "quoteAssetVolume": "7939220.41953600"
            },
            {
                "openTime": 1715922000000,
                "open": "2945.32000000",
                "high": "2949.94000000",
                "low": "2941.00000000",
                "close": "2947.34000000",
                "volume": "4853.16610000",
                "closeTime": 1715925599999,
                "quoteVolume": "14295499.47174900",
                "trades": 14549,
                "baseAssetVolume": "2390.44550000",
                "quoteAssetVolume": "7041294.00065000"
            },
            {
                "openTime": 1715925600000,
                "open": "2947.35000000",
                "high": "2967.99000000",
                "low": "2940.00000000",
                "close": "2960.47000000",
                "volume": "14836.52580000",
                "closeTime": 1715929199999,
                "quoteVolume": "43790140.65102300",
                "trades": 31599,
                "baseAssetVolume": "6429.83170000",
                "quoteAssetVolume": "18990548.72651400"
            },
            {
                "openTime": 1715929200000,
                "open": "2960.46000000",
                "high": "3033.00000000",
                "low": "2960.45000000",
                "close": "3024.67000000",
                "volume": "57064.57650000",
                "closeTime": 1715932799999,
                "quoteVolume": "171868485.28613800",
                "trades": 88892,
                "baseAssetVolume": "29549.97240000",
                "quoteAssetVolume": "88952095.99981300"
            },
            {
                "openTime": 1715932800000,
                "open": "3024.66000000",
                "high": "3059.53000000",
                "low": "3017.74000000",
                "close": "3028.15000000",
                "volume": "33359.98470000",
                "closeTime": 1715936399999,
                "quoteVolume": "101453400.98768800",
                "trades": 60476,
                "baseAssetVolume": "17795.74760000",
                "quoteAssetVolume": "54116073.98052700"
            },
            {
                "openTime": 1715936400000,
                "open": "3028.14000000",
                "high": "3035.71000000",
                "low": "3023.38000000",
                "close": "3028.01000000",
                "volume": "10685.37400000",
                "closeTime": 1715939999999,
                "quoteVolume": "32375109.41682200",
                "trades": 25062,
                "baseAssetVolume": "5578.86560000",
                "quoteAssetVolume": "16903381.58731800"
            },
            {
                "openTime": 1715940000000,
                "open": "3028.00000000",
                "high": "3039.75000000",
                "low": "3018.00000000",
                "close": "3037.10000000",
                "volume": "15510.15400000",
                "closeTime": 1715943599999,
                "quoteVolume": "47007783.06057300",
                "trades": 29994,
                "baseAssetVolume": "8279.65820000",
                "quoteAssetVolume": "25098784.51434200"
            },
            {
                "openTime": 1715943600000,
                "open": "3037.10000000",
                "high": "3037.81000000",
                "low": "3024.22000000",
                "close": "3030.40000000",
                "volume": "9042.13410000",
                "closeTime": 1715947199999,
                "quoteVolume": "27400031.07331300",
                "trades": 20404,
                "baseAssetVolume": "3832.72530000",
                "quoteAssetVolume": "11614402.03182100"
            },
            {
                "openTime": 1715947200000,
                "open": "3030.40000000",
                "high": "3084.90000000",
                "low": "3020.10000000",
                "close": "3079.79000000",
                "volume": "26334.57050000",
                "closeTime": 1715950799999,
                "quoteVolume": "80528964.89749300",
                "trades": 50131,
                "baseAssetVolume": "14659.52270000",
                "quoteAssetVolume": "44843800.46319500"
            },
            {
                "openTime": 1715950800000,
                "open": "3079.79000000",
                "high": "3088.59000000",
                "low": "3053.48000000",
                "close": "3059.48000000",
                "volume": "21973.27160000",
                "closeTime": 1715954399999,
                "quoteVolume": "67506705.12758200",
                "trades": 50811,
                "baseAssetVolume": "9213.53280000",
                "quoteAssetVolume": "28304954.82120100"
            },
            {
                "openTime": 1715954400000,
                "open": "3059.49000000",
                "high": "3094.55000000",
                "low": "3057.24000000",
                "close": "3092.00000000",
                "volume": "24088.35330000",
                "closeTime": 1715957999999,
                "quoteVolume": "74163570.24094400",
                "trades": 51828,
                "baseAssetVolume": "14127.18250000",
                "quoteAssetVolume": "43490959.24585600"
            },
            {
                "openTime": 1715958000000,
                "open": "3092.00000000",
                "high": "3118.54000000",
                "low": "3076.20000000",
                "close": "3111.54000000",
                "volume": "36567.92750000",
                "closeTime": 1715961599999,
                "quoteVolume": "113379283.65475800",
                "trades": 74564,
                "baseAssetVolume": "19446.57690000",
                "quoteAssetVolume": "60279234.17103900"
            },
            {
                "openTime": 1715961600000,
                "open": "3111.54000000",
                "high": "3120.00000000",
                "low": "3093.74000000",
                "close": "3095.75000000",
                "volume": "16142.22480000",
                "closeTime": 1715965199999,
                "quoteVolume": "50108407.97075200",
                "trades": 38217,
                "baseAssetVolume": "7238.76520000",
                "quoteAssetVolume": "22473936.07251500"
            },
            {
                "openTime": 1715965200000,
                "open": "3095.76000000",
                "high": "3102.79000000",
                "low": "3084.00000000",
                "close": "3085.44000000",
                "volume": "17473.91020000",
                "closeTime": 1715968799999,
                "quoteVolume": "54065374.25639600",
                "trades": 33072,
                "baseAssetVolume": "7884.14970000",
                "quoteAssetVolume": "24398225.69561600"
            },
            {
                "openTime": 1715968800000,
                "open": "3085.43000000",
                "high": "3089.61000000",
                "low": "3067.16000000",
                "close": "3087.41000000",
                "volume": "14203.57530000",
                "closeTime": 1715972399999,
                "quoteVolume": "43705251.03946700",
                "trades": 30522,
                "baseAssetVolume": "6949.85040000",
                "quoteAssetVolume": "21387898.12092700"
            },
            {
                "openTime": 1715972400000,
                "open": "3087.41000000",
                "high": "3089.58000000",
                "low": "3079.18000000",
                "close": "3085.16000000",
                "volume": "4631.31320000",
                "closeTime": 1715975999999,
                "quoteVolume": "14283579.00725100",
                "trades": 14134,
                "baseAssetVolume": "2287.32060000",
                "quoteAssetVolume": "7054526.70647500"
            },
            {
                "openTime": 1715976000000,
                "open": "3085.16000000",
                "high": "3091.99000000",
                "low": "3080.59000000",
                "close": "3088.99000000",
                "volume": "3643.41380000",
                "closeTime": 1715979599999,
                "quoteVolume": "11243620.59730300",
                "trades": 12800,
                "baseAssetVolume": "1771.45500000",
                "quoteAssetVolume": "5467247.10092600"
            },
            {
                "openTime": 1715979600000,
                "open": "3088.99000000",
                "high": "3094.00000000",
                "low": "3085.43000000",
                "close": "3086.19000000",
                "volume": "4055.60180000",
                "closeTime": 1715983199999,
                "quoteVolume": "12528084.61298400",
                "trades": 10814,
                "baseAssetVolume": "1799.92760000",
                "quoteAssetVolume": "5559985.93826400"
            },
            {
                "openTime": 1715983200000,
                "open": "3086.19000000",
                "high": "3095.76000000",
                "low": "3085.95000000",
                "close": "3090.99000000",
                "volume": "4128.11850000",
                "closeTime": 1715986799999,
                "quoteVolume": "12758365.81678900",
                "trades": 11411,
                "baseAssetVolume": "2195.02590000",
                "quoteAssetVolume": "6784147.29332900"
            },
            {
                "openTime": 1715986800000,
                "open": "3090.98000000",
                "high": "3094.34000000",
                "low": "3087.72000000",
                "close": "3092.01000000",
                "volume": "3801.84030000",
                "closeTime": 1715990399999,
                "quoteVolume": "11752978.61988400",
                "trades": 11309,
                "baseAssetVolume": "2058.51880000",
                "quoteAssetVolume": "6363846.72154700"
            },
            {
                "openTime": 1715990400000,
                "open": "3092.00000000",
                "high": "3098.80000000",
                "low": "3086.12000000",
                "close": "3096.45000000",
                "volume": "6069.83370000",
                "closeTime": 1715993999999,
                "quoteVolume": "18769081.56275800",
                "trades": 15911,
                "baseAssetVolume": "2978.79670000",
                "quoteAssetVolume": "9211699.26590400"
            },
            {
                "openTime": 1715994000000,
                "open": "3096.45000000",
                "high": "3099.00000000",
                "low": "3083.61000000",
                "close": "3089.91000000",
                "volume": "3263.39910000",
                "closeTime": 1715997599999,
                "quoteVolume": "10089751.52961000",
                "trades": 9879,
                "baseAssetVolume": "1405.25570000",
                "quoteAssetVolume": "4345766.41338800"
            },
            {
                "openTime": 1715997600000,
                "open": "3108.19000000",
                "high": "3109.40000000",
                "low": "3092.23000000",
                "close": "3099.06000000",
                "volume": "9378.36590000",
                "closeTime": 1716001199999,
                "quoteVolume": "29092845.73608600",
                "trades": 26851,
                "baseAssetVolume": "3642.16280000",
                "quoteAssetVolume": "11297774.59334700"
            },
            {
                "openTime": 1716001200000,
                "open": "3099.06000000",
                "high": "3126.66000000",
                "low": "3098.60000000",
                "close": "3114.40000000",
                "volume": "19575.31420000",
                "closeTime": 1716004799999,
                "quoteVolume": "60989422.07123800",
                "trades": 41610,
                "baseAssetVolume": "12176.69360000",
                "quoteAssetVolume": "37938258.94047900"
            },
            {
                "openTime": 1716004800000,
                "open": "3114.39000000",
                "high": "3119.94000000",
                "low": "3099.16000000",
                "close": "3101.84000000",
                "volume": "6957.40880000",
                "closeTime": 1716008399999,
                "quoteVolume": "21620457.34812900",
                "trades": 20417,
                "baseAssetVolume": "2862.70680000",
                "quoteAssetVolume": "8899583.08761600"
            },
            {
                "openTime": 1716008400000,
                "open": "3101.84000000",
                "high": "3102.29000000",
                "low": "3093.27000000",
                "close": "3093.36000000",
                "volume": "6283.64340000",
                "closeTime": 1716011999999,
                "quoteVolume": "19474831.95174000",
                "trades": 15997,
                "baseAssetVolume": "2080.32450000",
                "quoteAssetVolume": "6447753.35332300"
            }
            ],
            "movingAverage": [
                2962.2020500000012,
                2961.607950000001,
                2961.0134000000007,
                2960.5470000000005,
                2960.044050000001,
                2959.317950000001,
                2958.670150000001,
                2958.187900000001,
                2957.993750000001,
                2957.720550000001,
                2957.484700000001,
                2957.0925000000007,
                2956.9340500000003,
                2956.73925,
                2956.51725,
                2956.2966499999998,
                2956.1157499999995,
                2955.9151999999995,
                2955.7469499999993,
                2955.6410499999993,
                2955.7008499999997,
                2955.6455499999993,
                2955.556699999999,
                2955.4177499999996,
                2955.28835,
                2955.1242999999995,
                2954.910949999999,
                2954.5413499999995,
                2954.349149999999,
                2954.0758499999993,
                2953.8199499999987,
                2953.5332999999982,
                2953.329749999998,
                2953.005299999998,
                2952.5692999999974,
                2952.1116499999976,
                2951.8002499999975,
                2951.4634999999976,
                2951.1343999999976,
                2950.8379499999974,
                2950.593499999997,
                2950.5620499999973,
                2950.438699999997,
                2950.3951499999966,
                2950.647449999997,
                2950.895449999997,
                2951.0488499999974,
                2951.2418999999973,
                2951.404399999997,
                2951.8373999999976,
                2952.1135499999973,
                2952.5685499999977,
                2953.208299999998,
                2953.7629999999976,
                2954.277499999997,
                2954.9385999999977,
                2955.478399999998,
                2955.9825999999975,
                2956.5454999999974,
                2957.0644499999976,
                2957.4945499999976,
                2958.0037499999976,
                2958.4342999999976,
                2958.845599999998,
                2959.3105499999974,
                2959.710749999997,
                2960.075599999997
            ]
        };
        this.limit = 66;

        $(document).on('selectCurrencyForChart', async function (event, currency) {

            // Atualiza variável currency
            ShangaiChartView.currency = currency[0];
            // Atualiza chart
            ShangaiChartView.render()
        });

        this.render();

    },

    render: function () {

        this.option = {
            title: {
                text: `${this.currency.symbol} - ${this.currency.interval}`,
                left: 0
              },
            legend: {
                data: ['Candles', 'MA200', 'CL', 'BL', 'spanA', 'spanB'],
                inactiveColor: '#777'
            },
            tooltip: {
                trigger: 'axis',
                axisPointer: {
                    animation: false,
                    type: 'cross',
                    lineStyle: {
                        color: '#376df4',
                        width: 2,
                        opacity: 1
                    }
                }
            },
            xAxis: {
                type: 'category',
                //data: this.currency.candlesticks.slice(-this.limit - 24).map(item => new Date(item.openTime).getHours()),
                //data: this.currency.candlesticks.slice(-this.limit - 24).map(item => convertOpenTime(item.openTime, this.currency.interval )),
                data: (() => {
                    // Cria array com datas
                    let initialArray = this.currency.candlesticks.map(item => convertOpenTime(item.openTime, this.currency.interval ))
                    ;
                    // Adiciona valores vazios à frente, lugar da spanA e spanB, adiantadas 25 períodos
                    let valuesToPush = new Array(24).fill('');
                    // Concatena as udas arrays
                    return initialArray.concat(valuesToPush).slice(-this.limit - 24);
                })(),
                axisLine: {
                    lineStyle: {
                        color: '#8392A5'
                    }
                }
            },
            yAxis: {
                scale: true,
                axisLine: {
                    lineStyle: {
                        color: '#8392A5'
                    }
                },
                splitLine: {
                    show: false
                }
            },
            grid: {
                bottom: 80
            },
            dataZoom: [{
                textStyle: {
                    color: '#8392A5'
                },
                handleIcon: 'path://M10.7,11.9v-1.3H9.3v1.3c-4.9,0.3-8.8,4.4-8.8,9.4c0,5,3.9,9.1,8.8,9.4v1.3h1.3v-1.3c4.9-0.3,8.8-4.4,8.8-9.4C19.5,16.3,15.6,12.2,10.7,11.9z M13.3,24.4H6.7V23h6.6V24.4z M13.3,19.6H6.7v-1.4h6.6V19.6z',
                dataBackground: {
                    areaStyle: {
                        color: '#8392A5'
                    },
                    lineStyle: {
                        opacity: 0.8,
                        color: '#8392A5'
                    }
                },
                brushSelect: true
            },
            {
                type: 'inside'
            }
            ],
            series: [
                {
                    name: 'Candles',
                    type: 'candlestick',
                    data: this.currency.candlesticks.slice(-this.limit).map(item => [item.close, item.open, item.low, item.high]),
                    itemStyle: {
                       /* color: 'green',// '#FD1050',
                        color0: 'green', //#0CF49B',
                        borderColor: 'red', //'#FD1050',
                        borderColor0: 'red',// '#0CF49B'*/
                    }
                },
                {
                    name: 'MA200',
                    type: 'line',
                    data: this.currency.movingAverage.slice(-this.limit).map(item => item),
                    smooth: true,
                    showSymbol: false,
                    lineStyle: {
                        color: 'orange',
                        width: 2
                    }
                },
                {
                    name: 'CL',
                    type: 'line',
                    data: this.currency.ichimokuCloud.slice(-this.limit).map(item => item.conversion),
                    smooth: true,
                    showSymbol: false,
                    lineStyle: {
                        color: 'blue',
                        width: 1
                    }
                },
                {
                    name: 'BL',
                    type: 'line',
                    data: this.currency.ichimokuCloud.slice(-this.limit).map(item => item.base),
                    smooth: true,
                    showSymbol: false,
                    lineStyle: {
                        color: 'gray',
                        width: 1
                    }
                },
                {
                    name: 'spanA',
                    type: 'line',
                    data: this.currency.ichimokuCloud.slice(-this.limit - 24).map(item => item.spanA),
                    showSymbol: false,
                    lineStyle: {
                        color: 'green',
                        width: 1
                    }
                },
                {
                    name: 'spanB',
                    type: 'line',
                    data: this.currency.ichimokuCloud.slice(-this.limit - 24).map(item => item.spanB),
                    smooth: true,
                    showSymbol: false,
                    lineStyle: {
                        color: 'red',
                        width: 1
                    }
                }
            ]
        };

        if (this.option && typeof this.option === 'object') {
            this.shangaiIndex2.setOption(this.option);
        }

        window.addEventListener('resize', this.shangaiIndex2.resize);

    }


}

export { ShangaiChartView }