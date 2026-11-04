-- Demo venues for the pilot area (safe to keep; set status = 'suspended' to hide).
insert into venues (id, name, area, city, address, lat, lng, formats, floodlit, amenities, rules, about, rating, review_count) values
 ('v_bashundhara', 'Bashundhara Arena', 'Bashundhara', 'Dhaka', 'Block C, Road 5, Bashundhara R/A, Dhaka', 23.8191, 90.4526, '{5-a-side}', true,
  '{Floodlights,"Changing room",Parking,"Drinking water",Washroom}', '{"Arrive 15 minutes early","Turf boots or flat trainers only","No smoking on the pitch"}',
  '5-a-side pitch in Bashundhara with floodlights for night games.', 4.8, 212),
 ('v_kickoff_uttara', 'Kickoff Turf Uttara', 'Uttara', 'Dhaka', 'Sector 13, Uttara, Dhaka', 23.8728, 90.3984, '{5-a-side,7-a-side}', true,
  '{Floodlights,Parking,Café,Washroom}', '{"Arrive 15 minutes early","Turf boots or flat trainers only"}',
  '5-a-side and 7-a-side pitches in Uttara with floodlights.', 4.6, 148),
 ('v_gulshan_goal', 'Goal Zone Gulshan', 'Gulshan', 'Dhaka', 'Road 79, Gulshan 2, Dhaka', 23.7925, 90.4078, '{6-a-side}', true,
  '{Floodlights,"Changing room",Showers,Parking}', '{"Arrive 15 minutes early","No studs"}',
  '6-a-side pitch in Gulshan with floodlights.', 4.7, 96),
 ('v_badda_pitch', 'The Pitch Badda', 'Badda', 'Dhaka', 'Progoti Sarani, Middle Badda, Dhaka', 23.7806, 90.4265, '{5-a-side}', false,
  '{Parking,"Drinking water"}', '{"Arrive 15 minutes early"}', '5-a-side day pitch in Badda.', 4.4, 61),
 ('v_mirpur_dome', 'Mirpur Dome', 'Mirpur', 'Dhaka', 'Section 10, Mirpur, Dhaka', 23.8069, 90.3687, '{5-a-side,6-a-side}', true,
  '{Floodlights,Roof,"Changing room",Café}', '{"Arrive 15 minutes early","Turf boots or flat trainers only"}',
  'Covered 5- and 6-a-side pitch in Mirpur.', 4.5, 133),
 ('v_dhanmondi_box', 'Box Turf Dhanmondi', 'Dhanmondi', 'Dhaka', 'Road 27, Dhanmondi, Dhaka', 23.7461, 90.3742, '{5-a-side}', true,
  '{Floodlights,Washroom}', '{"Arrive 15 minutes early"}', '5-a-side box turf in Dhanmondi.', 4.3, 40)
on conflict (id) do nothing;

insert into venue_schedule (venue_id, open_min, close_min, session_min) values
 ('v_bashundhara', 360, 1800, 60), ('v_kickoff_uttara', 360, 1620, 90), ('v_gulshan_goal', 420, 1680, 60),
 ('v_badda_pitch', 360, 1440, 60), ('v_mirpur_dome', 360, 1800, 60), ('v_dhanmondi_box', 480, 1560, 60)
on conflict (venue_id) do nothing;

insert into venue_pricing (venue_id, standard_hourly, weekday_hourly) values
 ('v_bashundhara', 150000, '{"5":180000,"6":180000}'), ('v_kickoff_uttara', 250000, '{"5":450000,"6":450000}'),
 ('v_gulshan_goal', 220000, '{"5":280000,"6":280000}'), ('v_badda_pitch', 120000, '{}'),
 ('v_mirpur_dome', 180000, '{"5":240000,"6":240000}'), ('v_dhanmondi_box', 160000, '{"5":200000,"6":200000}')
on conflict (venue_id) do nothing;

insert into pitches (venue_id) select id from venues v where not exists (select 1 from pitches p where p.venue_id = v.id);

insert into venue_photos (venue_id, url, position)
select * from (values
 ('v_bashundhara', '/static/seed/venue-sunset.webp', 0), ('v_bashundhara', '/static/seed/venue-floodlit.webp', 1), ('v_bashundhara', '/static/seed/venue-arena.webp', 2),
 ('v_kickoff_uttara', '/static/seed/venue-evening.webp', 0), ('v_kickoff_uttara', '/static/seed/venue-dusk.webp', 1),
 ('v_gulshan_goal', '/static/seed/venue-floodlit.webp', 0), ('v_gulshan_goal', '/static/seed/venue-sunset.webp', 1),
 ('v_badda_pitch', '/static/seed/venue-dusk.webp', 0),
 ('v_mirpur_dome', '/static/seed/venue-arena.webp', 0), ('v_mirpur_dome', '/static/seed/venue-evening.webp', 1)
) as t(venue_id, url, position)
where not exists (select 1 from venue_photos);
