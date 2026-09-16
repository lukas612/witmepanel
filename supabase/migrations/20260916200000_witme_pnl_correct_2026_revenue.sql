-- Correct 2026 Jan-Jul revenue with the values verified straight from the source
-- sheets (Fuente A rows "INGRESOS ESPAÑA"/"INGRESOS PANAMA"/"GLOBAL - España &
-- Panama", cross-checked against Fuente B's "Ventas x mes 2026" table). The
-- previous seed approximated the España/Panamá split via an estimated FX rate;
-- the sheets already report it directly, and it turns out Panamá revenue was
-- shifted by one month in the original transcription. Costs were already
-- correct and are left untouched.

update public.witme_pnl_monthly set revenue = 955705.26 where year=2026 and month=1  and region='total';
update public.witme_pnl_monthly set revenue = 1072975.05 where year=2026 and month=2  and region='total';
update public.witme_pnl_monthly set revenue = 1170627.97 where year=2026 and month=3  and region='total';
update public.witme_pnl_monthly set revenue = 1045907.29 where year=2026 and month=4  and region='total';
update public.witme_pnl_monthly set revenue = 931326.29  where year=2026 and month=5  and region='total';
update public.witme_pnl_monthly set revenue = 993613.86  where year=2026 and month=6  and region='total';
update public.witme_pnl_monthly set revenue = 1309336.40 where year=2026 and month=7  and region='total';

update public.witme_pnl_monthly set revenue = 874153.00  where year=2026 and month=1  and region='espana';
update public.witme_pnl_monthly set revenue = 976090.00  where year=2026 and month=2  and region='espana';
update public.witme_pnl_monthly set revenue = 1090872.00 where year=2026 and month=3  and region='espana';
update public.witme_pnl_monthly set revenue = 966172.00  where year=2026 and month=4  and region='espana';
update public.witme_pnl_monthly set revenue = 848132.00  where year=2026 and month=5  and region='espana';
update public.witme_pnl_monthly set revenue = 829169.00  where year=2026 and month=6  and region='espana';
update public.witme_pnl_monthly set revenue = 1189603.00 where year=2026 and month=7  and region='espana';

update public.witme_pnl_monthly set revenue = 81552.26, revenue_usd = 94107.96  where year=2026 and month=1 and region='panama';
update public.witme_pnl_monthly set revenue = 96885.05, revenue_usd = 111801.37 where year=2026 and month=2 and region='panama';
update public.witme_pnl_monthly set revenue = 79755.97, revenue_usd = 92033.10  where year=2026 and month=3 and region='panama';
update public.witme_pnl_monthly set revenue = 79735.29, revenue_usd = 92009.15  where year=2026 and month=4 and region='panama';
update public.witme_pnl_monthly set revenue = 83194.29, revenue_usd = 96000.60  where year=2026 and month=5 and region='panama';
update public.witme_pnl_monthly set revenue = 164444.86, revenue_usd = 189763.90 where year=2026 and month=6 and region='panama';
update public.witme_pnl_monthly set revenue = 119733.40, revenue_usd = 138168.37 where year=2026 and month=7 and region='panama';

-- Replace the approximate monthly BCE/BoE rates with the actual fixed rate the
-- sheet itself uses (EUR/USD is constant across all 7 months, ~0.86655).
delete from public.witme_fx_rates where year = 2026 and currency_pair = 'USD_EUR';
insert into public.witme_fx_rates (year, month, currency_pair, rate) values
  (2026,1,'USD_EUR',0.8666),
  (2026,2,'USD_EUR',0.8666),
  (2026,3,'USD_EUR',0.8666),
  (2026,4,'USD_EUR',0.8666),
  (2026,5,'USD_EUR',0.8666),
  (2026,6,'USD_EUR',0.8666),
  (2026,7,'USD_EUR',0.8666);
