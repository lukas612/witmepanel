-- Seed: year config
insert into public.witme_year_config (year, has_split, visible_months) values
  (2025, false, 12),
  (2026, true, 7)
on conflict (year) do update set has_split = excluded.has_split, visible_months = excluded.visible_months;

-- Seed: 2025 total (no country split available in source sheet)
insert into public.witme_pnl_monthly (year, month, region, revenue, cost, is_real) values
  (2025,1,'total',525573.00,454524.31,true),
  (2025,2,'total',513918.00,476161.33,true),
  (2025,3,'total',740392.00,645297.96,true),
  (2025,4,'total',687872.00,631949.37,true),
  (2025,5,'total',807534.00,765805.29,true),
  (2025,6,'total',837399.00,764479.32,true),
  (2025,7,'total',1050407.00,971168.57,true),
  (2025,8,'total',1028089.00,900457.12,true),
  (2025,9,'total',1011470.00,960812.17,true),
  (2025,10,'total',985814.00,875881.52,true),
  (2025,11,'total',839045.00,812993.83,true),
  (2025,12,'total',784057.00,751493.21,true)
on conflict (year, month, region) do update set revenue = excluded.revenue, cost = excluded.cost, is_real = excluded.is_real;

-- Seed: 2026 total (combined España + Panamá)
insert into public.witme_pnl_monthly (year, month, region, revenue, cost, is_real) values
  (2026,1,'total',955705.00,890186.97,true),
  (2026,2,'total',1073218.00,1012844.74,true),
  (2026,3,'total',1171315.00,1173698.06,true),
  (2026,4,'total',1045828.00,989110.15,true),
  (2026,5,'total',931061.00,900685.34,true),
  (2026,6,'total',993534.00,928898.02,true),
  (2026,7,'total',1309336.00,1180716.42,true),
  (2026,8,'total',null,1056241.16,false),
  (2026,9,'total',null,22779.86,false),
  (2026,10,'total',null,8096.12,false),
  (2026,11,'total',null,2405.00,false),
  (2026,12,'total',null,2405.00,false)
on conflict (year, month, region) do update set revenue = excluded.revenue, cost = excluded.cost, is_real = excluded.is_real;

-- Seed: 2026 España (cost real from source sheet, revenue implicit = total - panamá convertido)
insert into public.witme_pnl_monthly (year, month, region, revenue, cost, is_real) values
  (2026,1,'espana',837055.00,885542.75,true),
  (2026,2,'espana',993623.00,1007273.59,true),
  (2026,3,'espana',1074607.00,1158621.76,true),
  (2026,4,'espana',966680.00,968875.93,true),
  (2026,5,'espana',851013.00,881664.76,true),
  (2026,6,'espana',909342.00,898353.89,true),
  (2026,7,'espana',1142887.00,1016283.55,true),
  (2026,8,'espana',null,843986.60,false),
  (2026,9,'espana',null,19607.21,false),
  (2026,10,'espana',null,8096.12,false),
  (2026,11,'espana',null,2405.00,false),
  (2026,12,'espana',null,2405.00,false)
on conflict (year, month, region) do update set revenue = excluded.revenue, cost = excluded.cost, is_real = excluded.is_real;

-- Seed: 2026 Panamá (revenue from Fuente B, converted from USD; revenue_usd kept for audit)
insert into public.witme_pnl_monthly (year, month, region, revenue, cost, revenue_usd, is_real) values
  (2026,1,'panama',118650.00,4644.22,139274.69,true),
  (2026,2,'panama',79595.00,5571.15,94107.96,true),
  (2026,3,'panama',96708.00,15076.30,111801.37,true),
  (2026,4,'panama',79148.00,20234.22,92033.10,true),
  (2026,5,'panama',80048.00,19020.58,92009.15,true),
  (2026,6,'panama',84192.00,30544.13,96000.60,true),
  (2026,7,'panama',166449.00,164432.87,189763.90,true),
  (2026,8,'panama',120897.00,212254.56,138168.37,false),
  (2026,9,'panama',32922.00,3172.65,37625.69,false),
  (2026,10,'panama',null,0,null,false),
  (2026,11,'panama',null,0,null,false),
  (2026,12,'panama',null,0,null,false)
on conflict (year, month, region) do update set revenue = excluded.revenue, cost = excluded.cost, revenue_usd = excluded.revenue_usd, is_real = excluded.is_real;

-- Seed: FX rates used to convert Panamá revenue USD -> EUR (approximate monthly averages, BCE/BoE)
insert into public.witme_fx_rates (year, month, currency_pair, rate) values
  (2026,1,'USD_EUR',0.852),
  (2026,2,'USD_EUR',0.846),
  (2026,3,'USD_EUR',0.865),
  (2026,4,'USD_EUR',0.860),
  (2026,5,'USD_EUR',0.870),
  (2026,6,'USD_EUR',0.877),
  (2026,7,'USD_EUR',0.877)
on conflict (year, month, currency_pair) do update set rate = excluded.rate;
