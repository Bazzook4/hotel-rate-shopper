-- Shared events for India (IN), October 2026 to the end of 2027.
--
-- One file per country and period; see README.md in this folder.
--
-- Public events (property_id NULL) tagged so each reaches the right hotels:
--   * national holidays and long weekends name only the country, and the
--     long weekends and school holidays only leisure kinds of property --
--     a city business hotel empties on a long weekend, it does not fill
--   * state festivals name the state (Pongal, Onam, Chhath, Garba)
--   * city events name the city (Durga Puja in Kolkata, Pushkar fair,
--     Nashik Kumbh bathing days, Ooty flower show)
--   * wedding seasons name only Wedding / Banquet properties
--
-- Dates were checked against the Government of India gazetted holiday lists
-- for 2026 and 2027 and the organisers' published dates. Festivals that
-- follow the lunar calendar can shift by a day locally, and Eid depends on
-- the moon; rows marked "approximate" in their notes need checking once the
-- dates are announced. Every row can be edited or deleted on the Events page.
--
-- Safe to run more than once: a row is skipped when a public event with the
-- same name, start date and place already exists.
--
-- Needs 039_events.sql first.

with leisure as (
  select '{leisure,resort,hill,beach,heritage,homestay}'::text[] as kinds
),
seed (name, category, start_date, end_date, impact, state, city, property_types, notes) as (
  values
  -- ---------------------------------------------------------------- 2026
  ('Navratri & Garba', 'festival', date '2026-10-11', date '2026-10-19', 'medium', 'Gujarat', null, '{}'::text[], 'Nine nights of Garba across Gujarat.'),
  ('Mysuru Dasara', 'festival', '2026-10-11', '2026-10-20', 'high', 'Karnataka', 'Mysuru', '{}', 'Jamboo Savari procession on Vijayadashami, 20 Oct.'),
  ('Durga Puja', 'festival', '2026-10-16', '2026-10-21', 'high', 'West Bengal', 'Kolkata', '{}', 'Shashthi 16 Oct to Bijoya Dashami 21 Oct (Bengal panchang).'),
  ('Dussehra long weekend', 'long_weekend', '2026-10-17', '2026-10-20', 'medium', null, null, (select kinds from leisure), 'Dussehra Tue 20 Oct; a Monday off makes four days.'),
  ('Diwali', 'festival', '2026-11-06', '2026-11-11', 'high', null, null, (select kinds from leisure), 'Diwali Sun 8 Nov, Govardhan Puja 9 Nov, Bhai Dooj 11 Nov.'),
  ('Chhath Puja', 'festival', '2026-11-13', '2026-11-16', 'medium', 'Bihar', null, '{}', 'Main day Sun 15 Nov.'),
  ('Pushkar Camel Fair', 'festival', '2026-11-17', '2026-11-24', 'high', 'Rajasthan', 'Pushkar', '{}', 'Peak 21-22 Nov; Kartik Purnima bathing 24 Nov.'),
  ('Wedding season', 'wedding_season', '2026-11-21', '2026-12-14', 'medium', null, null, '{wedding}', 'Approximate: Dev Uthani Ekadashi to the start of Kharmas. Check muhurat dates.'),
  ('Dev Deepawali', 'festival', '2026-11-23', '2026-11-25', 'high', 'Uttar Pradesh', 'Varanasi', '{}', 'Ghats lit on Kartik Purnima, 24 Nov.'),
  ('Guru Nanak Jayanti', 'festival', '2026-11-24', '2026-11-24', 'medium', 'Punjab', 'Amritsar', '{}', null),
  ('Hornbill Festival', 'festival', '2026-12-01', '2026-12-10', 'high', 'Nagaland', 'Kohima', '{}', 'Held 1-10 December every year at Kisama.'),
  ('Konark Dance Festival', 'festival', '2026-12-01', '2026-12-05', 'medium', 'Odisha', 'Konark', '{}', 'Held 1-5 December every year.'),
  ('Christmas & New Year in Goa', 'festival', '2026-12-20', '2027-01-02', 'high', 'Goa', null, '{}', 'Goa''s peak fortnight.'),
  ('Winter school holidays', 'school_holiday', '2026-12-24', '2027-01-01', 'medium', null, null, (select kinds from leisure), 'Most school boards break for Christmas and New Year.'),
  ('Christmas long weekend', 'long_weekend', '2026-12-25', '2026-12-27', 'medium', null, null, (select kinds from leisure), 'Christmas Fri 25 Dec.'),
  ('New Year''s Eve weekend', 'long_weekend', '2026-12-31', '2027-01-03', 'high', null, null, (select kinds from leisure), 'New Year''s Eve Thu 31 Dec; Fri 1 Jan off for many.'),

  -- ---------------------------------------------------------------- 2027
  ('Lohri', 'festival', '2027-01-13', '2027-01-13', 'low', 'Punjab', null, '{}', null),
  ('Pongal', 'festival', '2027-01-13', '2027-01-16', 'medium', 'Tamil Nadu', null, '{}', 'Bhogi 13 Jan, Thai Pongal 14 Jan, Mattu Pongal 15 Jan, Kaanum Pongal 16 Jan.'),
  ('Uttarayan kite festival', 'festival', '2027-01-14', '2027-01-15', 'medium', 'Gujarat', null, '{}', 'Makar Sankranti.'),
  ('Wedding season', 'wedding_season', '2027-01-15', '2027-03-14', 'medium', null, null, '{wedding}', 'Approximate: end of Kharmas to Holashtak. Check muhurat dates.'),
  ('Republic Day long weekend', 'long_weekend', '2027-01-23', '2027-01-26', 'medium', null, null, (select kinds from leisure), 'Republic Day Tue 26 Jan; a Monday off makes four days.'),
  ('Goa Carnival', 'festival', '2027-02-06', '2027-02-09', 'high', 'Goa', null, '{}', 'The four days before Ash Wednesday (10 Feb).'),
  ('Maha Shivaratri', 'festival', '2027-03-06', '2027-03-06', 'medium', null, null, '{pilgrimage}', 'Sat 6 Mar.'),
  ('Id-ul-Fitr', 'holiday', '2027-03-10', '2027-03-10', 'low', null, null, '{}', 'Wed 10 Mar, subject to the moon.'),
  ('Holi in Braj', 'festival', '2027-03-16', '2027-03-23', 'high', 'Uttar Pradesh', 'Mathura', '{}', 'The week of Lathmar and temple Holi before Holi on Tue 23 Mar.'),
  ('Holi in Braj', 'festival', '2027-03-16', '2027-03-23', 'high', 'Uttar Pradesh', 'Vrindavan', '{}', 'The week of temple Holi before Holi on Tue 23 Mar.'),
  ('Holi long weekend', 'long_weekend', '2027-03-20', '2027-03-23', 'medium', null, null, (select kinds from leisure), 'Holi Tue 23 Mar; a Monday off makes four days.'),
  ('Easter long weekend', 'long_weekend', '2027-03-26', '2027-03-28', 'medium', null, null, (select kinds from leisure), 'Good Friday 26 Mar.'),
  ('Wedding season', 'wedding_season', '2027-04-15', '2027-07-14', 'medium', null, null, '{wedding}', 'Approximate: end of Kharmas to Devshayani Ekadashi. Check muhurat dates.'),
  ('Mahavir Jayanti long weekend', 'long_weekend', '2027-04-17', '2027-04-19', 'medium', null, null, (select kinds from leisure), 'Mahavir Jayanti Mon 19 Apr.'),
  ('Summer holidays in the hills', 'school_holiday', '2027-05-01', '2027-06-15', 'high', null, null, '{hill}', 'School summer break; the hill stations'' peak. Dates vary by state.'),
  ('Summer school holidays', 'school_holiday', '2027-05-01', '2027-06-15', 'medium', null, null, '{leisure,resort,beach,heritage,homestay}', 'Dates vary by state and school board.'),
  ('Ooty Flower Show', 'festival', '2027-05-14', '2027-05-18', 'high', 'Tamil Nadu', 'Ooty', '{}', 'Approximate: held mid-May at the Government Botanical Garden; dates announced in spring.'),
  ('Bakrid long weekend', 'long_weekend', '2027-05-15', '2027-05-17', 'medium', null, null, (select kinds from leisure), 'Id-ul-Zuha Mon 17 May, subject to the moon.'),
  ('Buddha Purnima', 'festival', '2027-05-20', '2027-05-20', 'medium', 'Bihar', 'Bodh Gaya', '{}', null),
  ('Rath Yatra', 'festival', '2027-07-04', '2027-07-06', 'high', 'Odisha', 'Puri', '{}', 'Chariot festival Mon 5 Jul.'),
  ('Simhastha Kumbh: first Amrit Snan', 'festival', '2027-08-01', '2027-08-03', 'high', 'Maharashtra', 'Nashik', '{}', 'Amrit Snan Mon 2 Aug at Nashik and Trimbakeshwar.'),
  ('Simhastha Kumbh: second Amrit Snan', 'festival', '2027-08-30', '2027-09-01', 'high', 'Maharashtra', 'Nashik', '{}', 'Amrit Snan Tue 31 Aug.'),
  ('Simhastha Kumbh: third Amrit Snan', 'festival', '2027-09-10', '2027-09-13', 'high', 'Maharashtra', 'Nashik', '{}', 'Nashik 11 Sep, Trimbakeshwar 12 Sep.'),
  ('Janmashtami', 'festival', '2027-08-24', '2027-08-26', 'high', 'Uttar Pradesh', 'Mathura', '{}', 'Wed 25 Aug.'),
  ('Janmashtami', 'festival', '2027-08-24', '2027-08-26', 'high', 'Uttar Pradesh', 'Vrindavan', '{}', 'Wed 25 Aug.'),
  ('Ganesh Chaturthi', 'festival', '2027-09-04', '2027-09-14', 'high', 'Maharashtra', 'Mumbai', '{}', 'Sat 4 Sep to Anant Chaturdashi immersion.'),
  ('Ganesh Chaturthi', 'festival', '2027-09-04', '2027-09-14', 'high', 'Maharashtra', 'Pune', '{}', 'Sat 4 Sep to Anant Chaturdashi immersion.'),
  ('Onam', 'festival', '2027-09-10', '2027-09-13', 'medium', 'Kerala', null, '{}', 'Thiruvonam Sun 12 Sep.'),
  ('Navratri & Garba', 'festival', '2027-09-30', '2027-10-08', 'medium', 'Gujarat', null, '{}', 'Nine nights of Garba across Gujarat.'),
  ('Mysuru Dasara', 'festival', '2027-09-30', '2027-10-09', 'high', 'Karnataka', 'Mysuru', '{}', 'Jamboo Savari procession on Vijayadashami, Sat 9 Oct.'),
  ('Durga Puja', 'festival', '2027-10-05', '2027-10-09', 'high', 'West Bengal', 'Kolkata', '{}', 'Ashtami Thu 7 Oct, Dashami Sat 9 Oct. Check the Bengal panchang for Shashthi.'),
  ('Diwali', 'festival', '2027-10-28', '2027-10-31', 'high', null, null, (select kinds from leisure), 'Diwali Fri 29 Oct.'),
  ('Pushkar Camel Fair', 'festival', '2027-11-07', '2027-11-14', 'high', 'Rajasthan', 'Pushkar', '{}', 'Approximate: the week up to Kartik Purnima (14 Nov). Check the fair''s published dates.'),
  ('Wedding season', 'wedding_season', '2027-11-10', '2027-12-14', 'medium', null, null, '{wedding}', 'Approximate: Dev Uthani Ekadashi to the start of Kharmas. Check muhurat dates.'),
  ('Dev Deepawali', 'festival', '2027-11-13', '2027-11-15', 'high', 'Uttar Pradesh', 'Varanasi', '{}', 'Ghats lit on Kartik Purnima, 14 Nov.'),
  ('Guru Nanak Jayanti', 'festival', '2027-11-14', '2027-11-14', 'medium', 'Punjab', 'Amritsar', '{}', 'Sun 14 Nov.'),
  ('Hornbill Festival', 'festival', '2027-12-01', '2027-12-10', 'high', 'Nagaland', 'Kohima', '{}', 'Held 1-10 December every year at Kisama.'),
  ('Konark Dance Festival', 'festival', '2027-12-01', '2027-12-05', 'medium', 'Odisha', 'Konark', '{}', 'Held 1-5 December every year.'),
  ('Christmas & New Year in Goa', 'festival', '2027-12-20', '2028-01-02', 'high', 'Goa', null, '{}', 'Goa''s peak fortnight.'),
  ('Winter school holidays', 'school_holiday', '2027-12-24', '2028-01-01', 'medium', null, null, (select kinds from leisure), 'Most school boards break for Christmas and New Year.'),
  ('Christmas long weekend', 'long_weekend', '2027-12-24', '2027-12-26', 'medium', null, null, (select kinds from leisure), 'Christmas Sat 25 Dec.'),
  ('New Year''s Eve weekend', 'long_weekend', '2027-12-31', '2028-01-02', 'high', null, null, (select kinds from leisure), 'New Year''s Eve Fri 31 Dec.')
)
insert into events (name, category, start_date, end_date, impact, notes, country_code, state, city, property_types)
select s.name, s.category, s.start_date, s.end_date, s.impact, s.notes, 'IN', s.state, s.city, s.property_types
from seed s
where not exists (
  select 1 from events e
  where e.property_id is null
    and e.country_code = 'IN'
    and e.name = s.name
    and e.start_date = s.start_date
    and e.state is not distinct from s.state
    and e.city is not distinct from s.city
);
