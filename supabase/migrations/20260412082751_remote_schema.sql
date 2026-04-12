drop extension if exists "pg_net";

drop trigger if exists "update_app_content_updated_at" on "public"."app_content";

drop trigger if exists "update_email_templates_updated_at" on "public"."email_templates";

drop trigger if exists "set_notifications_updated_at" on "public"."notifications";

drop trigger if exists "update_onboarding_updated_at" on "public"."onboarding";

drop trigger if exists "update_organizations_updated_at" on "public"."organizations";

drop trigger if exists "update_profiles_updated_at" on "public"."profiles";

drop trigger if exists "update_template_bundles_updated_at" on "public"."template_bundles";

drop trigger if exists "update_templates_updated_at" on "public"."templates";

drop policy "Users can view analytics for their organization" on "public"."analytics";

drop policy "Users can view app content in their organization" on "public"."app_content";

drop policy "Users can create address lists in their organization" on "public"."campaign_csv_address_lists";

drop policy "Users can update address lists in their organization" on "public"."campaign_csv_address_lists";

drop policy "Users can view address lists in their organization" on "public"."campaign_csv_address_lists";

drop policy "Users can view campaign history in their organization" on "public"."campaign_history";

drop policy "Users can view campaigns in their organization" on "public"."campaigns";

drop policy "Users can view analytics for their organization" on "public"."detailed_analytics";

drop policy "ADMIN/MARKETER can manage launch data for their organization" on "public"."launch_ready_campaign_data";

drop policy "Users can view launch data for their organization campaigns" on "public"."launch_ready_campaign_data";

drop policy "Enable update for users based on organization_id" on "public"."notifications";

drop policy "Users can update their notifications" on "public"."notifications";

drop policy "Users can view their organization notifications" on "public"."notifications";

drop policy "Users can insert onboarding for their organization" on "public"."onboarding";

drop policy "Users can update onboarding for their organization" on "public"."onboarding";

drop policy "Users can view onboarding for their organization" on "public"."onboarding";

drop policy "Users can view payment history in their organization" on "public"."payment_history";

drop policy "Admins can delete any profile" on "public"."profiles";

drop policy "Admins can update any profile" on "public"."profiles";

drop policy "Admins can view all profiles" on "public"."profiles";

drop policy "Users can update own profile" on "public"."profiles";

drop policy "Users can view referrals in their organization" on "public"."referrals";

drop policy "Users can view bundles in their organization or universal" on "public"."template_bundles";

drop policy "Users can view template history in their organization" on "public"."template_history";

alter table "public"."analytics" drop constraint "analytics_organization_id_fkey";

alter table "public"."app_content" drop constraint "app_content_organization_id_fkey";

alter table "public"."campaign_csv_address_lists" drop constraint "campaign_csv_address_lists_campaign_id_fkey";

alter table "public"."campaign_csv_address_lists" drop constraint "campaign_csv_address_lists_organization_id_fkey";

alter table "public"."campaign_history" drop constraint "campaign_history_campaign_id_fkey";

alter table "public"."campaigns" drop constraint "campaigns_csv_address_list_id_fkey";

alter table "public"."campaigns" drop constraint "campaigns_launch_ready_id_fkey";

alter table "public"."campaigns" drop constraint "campaigns_organization_id_fkey";

alter table "public"."campaigns" drop constraint "campaigns_referral_id_fkey";

alter table "public"."campaigns" drop constraint "campaigns_zone_id_fkey";

alter table "public"."detailed_analytics" drop constraint "detailed_analytics_campaign_id_fkey";

alter table "public"."detailed_analytics" drop constraint "detailed_analytics_organization_id_fkey";

alter table "public"."gallery" drop constraint "gallery_organization_id_fkey";

alter table "public"."gallery" drop constraint "gallery_referral_id_fkey";

alter table "public"."launch_ready_campaign_data" drop constraint "launch_ready_campaign_data_campaign_id_fkey";

alter table "public"."launch_ready_campaign_data" drop constraint "launch_ready_campaign_data_csv_address_list_id_fkey";

alter table "public"."launch_ready_campaign_data" drop constraint "launch_ready_campaign_data_zone_id_fkey";

alter table "public"."location_zones" drop constraint "location_zones_campaign_id_fkey";

alter table "public"."location_zones" drop constraint "location_zones_organization_id_fkey";

alter table "public"."notifications" drop constraint "notifications_organization_id_fkey";

alter table "public"."onboarding" drop constraint "onboarding_organization_id_fkey";

alter table "public"."org_switch_log" drop constraint "org_switch_log_from_org_id_fkey";

alter table "public"."org_switch_log" drop constraint "org_switch_log_to_org_id_fkey";

alter table "public"."payment_history" drop constraint "payment_history_campaign_id_fkey";

alter table "public"."payment_history" drop constraint "payment_history_organization_id_fkey";

alter table "public"."profiles" drop constraint "profiles_active_organization_id_fkey";

alter table "public"."referral_history" drop constraint "referral_history_referral_id_fkey";

alter table "public"."referrals" drop constraint "fk_referrals_signature";

alter table "public"."referrals" drop constraint "referrals_campaign_id_fkey";

alter table "public"."referrals" drop constraint "referrals_organization_id_fkey";

alter table "public"."signatures" drop constraint "fk_signatures_referral";

alter table "public"."system_preferences" drop constraint "system_preferences_selected_currency_id_fkey";

alter table "public"."system_preferences" drop constraint "system_preferences_selected_timezone_id_fkey";

alter table "public"."template_bundles" drop constraint "template_bundles_organization_id_fkey";

alter table "public"."template_bundles" drop constraint "template_bundles_template_back_id_fkey";

alter table "public"."template_bundles" drop constraint "template_bundles_template_front_id_fkey";

alter table "public"."template_history" drop constraint "template_history_template_id_fkey";

alter table "public"."templates" drop constraint "templates_organization_id_fkey";

alter table "public"."us_cities" drop constraint "us_cities_state_id_fkey";

alter table "public"."world_states" drop constraint "world_states_country_id_fkey";

alter table "public"."app_content" alter column "role" set data type public.user_role using "role"::text::public.user_role;

alter table "public"."campaign_csv_address_lists" drop column "center";

alter table "public"."campaign_csv_address_lists" drop column "zone_name";

alter table "public"."campaigns" drop column "tracker_id";

alter table "public"."campaigns" alter column "campaign_target_type" set data type public.campaign_target_type using "campaign_target_type"::text::public.campaign_target_type;

alter table "public"."multi_org_intent" enable row level security;

alter table "public"."org_switch_log" enable row level security;

alter table "public"."profiles" alter column "role" set default 'TECHNICIAN'::public.user_role;

alter table "public"."profiles" alter column "role" set data type public.user_role using "role"::text::public.user_role;

alter table "public"."templates" alter column "postcard_size" set data type public.postcard_size using "postcard_size"::text::public.postcard_size;

alter table "public"."templates" alter column "template_type" set data type public.template_type using "template_type"::text::public.template_type;

alter table "public"."analytics" add constraint "analytics_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."analytics" validate constraint "analytics_organization_id_fkey";

alter table "public"."app_content" add constraint "app_content_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."app_content" validate constraint "app_content_organization_id_fkey";

alter table "public"."campaign_csv_address_lists" add constraint "campaign_csv_address_lists_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL not valid;

alter table "public"."campaign_csv_address_lists" validate constraint "campaign_csv_address_lists_campaign_id_fkey";

alter table "public"."campaign_csv_address_lists" add constraint "campaign_csv_address_lists_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."campaign_csv_address_lists" validate constraint "campaign_csv_address_lists_organization_id_fkey";

alter table "public"."campaign_history" add constraint "campaign_history_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE not valid;

alter table "public"."campaign_history" validate constraint "campaign_history_campaign_id_fkey";

alter table "public"."campaigns" add constraint "campaigns_csv_address_list_id_fkey" FOREIGN KEY (csv_address_list_id) REFERENCES public.campaign_csv_address_lists(id) ON DELETE SET NULL not valid;

alter table "public"."campaigns" validate constraint "campaigns_csv_address_list_id_fkey";

alter table "public"."campaigns" add constraint "campaigns_launch_ready_id_fkey" FOREIGN KEY (launch_ready_id) REFERENCES public.launch_ready_campaign_data(id) ON DELETE SET NULL not valid;

alter table "public"."campaigns" validate constraint "campaigns_launch_ready_id_fkey";

alter table "public"."campaigns" add constraint "campaigns_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."campaigns" validate constraint "campaigns_organization_id_fkey";

alter table "public"."campaigns" add constraint "campaigns_referral_id_fkey" FOREIGN KEY (referral_id) REFERENCES public.referrals(id) ON DELETE CASCADE not valid;

alter table "public"."campaigns" validate constraint "campaigns_referral_id_fkey";

alter table "public"."campaigns" add constraint "campaigns_zone_id_fkey" FOREIGN KEY (zone_id) REFERENCES public.location_zones(id) ON DELETE SET NULL not valid;

alter table "public"."campaigns" validate constraint "campaigns_zone_id_fkey";

alter table "public"."detailed_analytics" add constraint "detailed_analytics_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE not valid;

alter table "public"."detailed_analytics" validate constraint "detailed_analytics_campaign_id_fkey";

alter table "public"."detailed_analytics" add constraint "detailed_analytics_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."detailed_analytics" validate constraint "detailed_analytics_organization_id_fkey";

alter table "public"."gallery" add constraint "gallery_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."gallery" validate constraint "gallery_organization_id_fkey";

alter table "public"."gallery" add constraint "gallery_referral_id_fkey" FOREIGN KEY (referral_id) REFERENCES public.referrals(id) ON DELETE CASCADE not valid;

alter table "public"."gallery" validate constraint "gallery_referral_id_fkey";

alter table "public"."launch_ready_campaign_data" add constraint "launch_ready_campaign_data_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE not valid;

alter table "public"."launch_ready_campaign_data" validate constraint "launch_ready_campaign_data_campaign_id_fkey";

alter table "public"."launch_ready_campaign_data" add constraint "launch_ready_campaign_data_csv_address_list_id_fkey" FOREIGN KEY (csv_address_list_id) REFERENCES public.campaign_csv_address_lists(id) ON DELETE SET NULL not valid;

alter table "public"."launch_ready_campaign_data" validate constraint "launch_ready_campaign_data_csv_address_list_id_fkey";

alter table "public"."launch_ready_campaign_data" add constraint "launch_ready_campaign_data_zone_id_fkey" FOREIGN KEY (zone_id) REFERENCES public.location_zones(id) ON DELETE CASCADE not valid;

alter table "public"."launch_ready_campaign_data" validate constraint "launch_ready_campaign_data_zone_id_fkey";

alter table "public"."location_zones" add constraint "location_zones_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE not valid;

alter table "public"."location_zones" validate constraint "location_zones_campaign_id_fkey";

alter table "public"."location_zones" add constraint "location_zones_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."location_zones" validate constraint "location_zones_organization_id_fkey";

alter table "public"."notifications" add constraint "notifications_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."notifications" validate constraint "notifications_organization_id_fkey";

alter table "public"."onboarding" add constraint "onboarding_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."onboarding" validate constraint "onboarding_organization_id_fkey";

alter table "public"."org_switch_log" add constraint "org_switch_log_from_org_id_fkey" FOREIGN KEY (from_org_id) REFERENCES public.organizations(id) ON DELETE SET NULL not valid;

alter table "public"."org_switch_log" validate constraint "org_switch_log_from_org_id_fkey";

alter table "public"."org_switch_log" add constraint "org_switch_log_to_org_id_fkey" FOREIGN KEY (to_org_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."org_switch_log" validate constraint "org_switch_log_to_org_id_fkey";

alter table "public"."payment_history" add constraint "payment_history_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL not valid;

alter table "public"."payment_history" validate constraint "payment_history_campaign_id_fkey";

alter table "public"."payment_history" add constraint "payment_history_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."payment_history" validate constraint "payment_history_organization_id_fkey";

alter table "public"."profiles" add constraint "profiles_active_organization_id_fkey" FOREIGN KEY (active_organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL not valid;

alter table "public"."profiles" validate constraint "profiles_active_organization_id_fkey";

alter table "public"."referral_history" add constraint "referral_history_referral_id_fkey" FOREIGN KEY (referral_id) REFERENCES public.referrals(id) ON DELETE CASCADE not valid;

alter table "public"."referral_history" validate constraint "referral_history_referral_id_fkey";

alter table "public"."referrals" add constraint "fk_referrals_signature" FOREIGN KEY (signature_id) REFERENCES public.signatures(id) ON DELETE SET NULL not valid;

alter table "public"."referrals" validate constraint "fk_referrals_signature";

alter table "public"."referrals" add constraint "referrals_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL not valid;

alter table "public"."referrals" validate constraint "referrals_campaign_id_fkey";

alter table "public"."referrals" add constraint "referrals_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."referrals" validate constraint "referrals_organization_id_fkey";

alter table "public"."signatures" add constraint "fk_signatures_referral" FOREIGN KEY (referral_id) REFERENCES public.referrals(id) ON DELETE SET NULL not valid;

alter table "public"."signatures" validate constraint "fk_signatures_referral";

alter table "public"."system_preferences" add constraint "system_preferences_selected_currency_id_fkey" FOREIGN KEY (selected_currency_id) REFERENCES public.currencies(id) not valid;

alter table "public"."system_preferences" validate constraint "system_preferences_selected_currency_id_fkey";

alter table "public"."system_preferences" add constraint "system_preferences_selected_timezone_id_fkey" FOREIGN KEY (selected_timezone_id) REFERENCES public.timezones(id) not valid;

alter table "public"."system_preferences" validate constraint "system_preferences_selected_timezone_id_fkey";

alter table "public"."template_bundles" add constraint "template_bundles_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."template_bundles" validate constraint "template_bundles_organization_id_fkey";

alter table "public"."template_bundles" add constraint "template_bundles_template_back_id_fkey" FOREIGN KEY (template_back_id) REFERENCES public.templates(id) ON DELETE CASCADE not valid;

alter table "public"."template_bundles" validate constraint "template_bundles_template_back_id_fkey";

alter table "public"."template_bundles" add constraint "template_bundles_template_front_id_fkey" FOREIGN KEY (template_front_id) REFERENCES public.templates(id) ON DELETE CASCADE not valid;

alter table "public"."template_bundles" validate constraint "template_bundles_template_front_id_fkey";

alter table "public"."template_history" add constraint "template_history_template_id_fkey" FOREIGN KEY (template_id) REFERENCES public.templates(id) ON DELETE CASCADE not valid;

alter table "public"."template_history" validate constraint "template_history_template_id_fkey";

alter table "public"."templates" add constraint "templates_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."templates" validate constraint "templates_organization_id_fkey";

alter table "public"."us_cities" add constraint "us_cities_state_id_fkey" FOREIGN KEY (state_id) REFERENCES public.us_states(id) ON DELETE CASCADE not valid;

alter table "public"."us_cities" validate constraint "us_cities_state_id_fkey";

alter table "public"."world_states" add constraint "world_states_country_id_fkey" FOREIGN KEY (country_id) REFERENCES public.countries(id) ON DELETE CASCADE not valid;

alter table "public"."world_states" validate constraint "world_states_country_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.get_user_role(user_id uuid)
 RETURNS public.user_role
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT role FROM profiles WHERE id = user_id;
$function$
;


  create policy "Users can view analytics for their organization"
  on "public"."analytics"
  as permissive
  for select
  to public
using ((organization_id IN ( SELECT organizations.id
   FROM public.organizations
  WHERE ((organizations.owner_id = auth.uid()) OR (auth.uid() IN ( SELECT ((jsonb_array_elements(organizations_1.organization_members) ->> 'member_uid'::text))::uuid AS uuid
           FROM public.organizations organizations_1
          WHERE (organizations_1.id = analytics.organization_id)))))));



  create policy "Users can view app content in their organization"
  on "public"."app_content"
  as permissive
  for select
  to authenticated
using ((organization_id IN ( SELECT organizations.id
   FROM public.organizations
  WHERE ((organizations.owner_id = auth.uid()) OR (auth.uid() IN ( SELECT (jsonb_array_elements_text(organizations.organization_members))::uuid AS jsonb_array_elements_text))))));



  create policy "Users can create address lists in their organization"
  on "public"."campaign_csv_address_lists"
  as permissive
  for insert
  to authenticated
with check ((organization_id IN ( SELECT organizations.id
   FROM public.organizations
  WHERE ((organizations.owner_id = auth.uid()) OR (auth.uid() IN ( SELECT (jsonb_array_elements_text(organizations.organization_members))::uuid AS jsonb_array_elements_text))))));



  create policy "Users can update address lists in their organization"
  on "public"."campaign_csv_address_lists"
  as permissive
  for update
  to authenticated
using ((organization_id IN ( SELECT organizations.id
   FROM public.organizations
  WHERE ((organizations.owner_id = auth.uid()) OR (auth.uid() IN ( SELECT (jsonb_array_elements_text(organizations.organization_members))::uuid AS jsonb_array_elements_text))))))
with check ((organization_id IN ( SELECT organizations.id
   FROM public.organizations
  WHERE ((organizations.owner_id = auth.uid()) OR (auth.uid() IN ( SELECT (jsonb_array_elements_text(organizations.organization_members))::uuid AS jsonb_array_elements_text))))));



  create policy "Users can view address lists in their organization"
  on "public"."campaign_csv_address_lists"
  as permissive
  for select
  to authenticated
using ((organization_id IN ( SELECT organizations.id
   FROM public.organizations
  WHERE ((organizations.owner_id = auth.uid()) OR (auth.uid() IN ( SELECT (jsonb_array_elements_text(organizations.organization_members))::uuid AS jsonb_array_elements_text))))));



  create policy "Users can view campaign history in their organization"
  on "public"."campaign_history"
  as permissive
  for select
  to authenticated
using ((campaign_id IN ( SELECT campaigns.id
   FROM public.campaigns
  WHERE (campaigns.organization_id IN ( SELECT organizations.id
           FROM public.organizations
          WHERE ((organizations.owner_id = auth.uid()) OR (auth.uid() IN ( SELECT (jsonb_array_elements_text(organizations.organization_members))::uuid AS jsonb_array_elements_text))))))));



  create policy "Users can view campaigns in their organization"
  on "public"."campaigns"
  as permissive
  for select
  to authenticated
using ((organization_id IN ( SELECT organizations.id
   FROM public.organizations
  WHERE ((organizations.owner_id = auth.uid()) OR (auth.uid() IN ( SELECT (jsonb_array_elements_text(organizations.organization_members))::uuid AS jsonb_array_elements_text))))));



  create policy "Users can view analytics for their organization"
  on "public"."detailed_analytics"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.organizations o
  WHERE ((o.id = detailed_analytics.organization_id) AND ((o.owner_id = auth.uid()) OR (o.organization_members @> jsonb_build_array(jsonb_build_object('member_uid', (auth.uid())::text))))))));



  create policy "ADMIN/MARKETER can manage launch data for their organization"
  on "public"."launch_ready_campaign_data"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM (public.campaigns c
     JOIN public.organizations o ON ((c.organization_id = o.id)))
  WHERE ((c.id = launch_ready_campaign_data.campaign_id) AND ((o.owner_id = auth.uid()) OR ((o.organization_members @> jsonb_build_array(jsonb_build_object('member_uid', (auth.uid())::text))) AND (EXISTS ( SELECT 1
           FROM jsonb_array_elements(o.organization_members) member(value)
          WHERE (((member.value ->> 'member_uid'::text) = (auth.uid())::text) AND ((member.value ->> 'member_role'::text) = ANY (ARRAY['ADMIN'::text, 'MARKETER'::text])))))))))));



  create policy "Users can view launch data for their organization campaigns"
  on "public"."launch_ready_campaign_data"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM (public.campaigns c
     JOIN public.organizations o ON ((c.organization_id = o.id)))
  WHERE ((c.id = launch_ready_campaign_data.campaign_id) AND ((o.owner_id = auth.uid()) OR (o.organization_members @> jsonb_build_array(jsonb_build_object('member_uid', (auth.uid())::text))))))));



  create policy "Enable update for users based on organization_id"
  on "public"."notifications"
  as permissive
  for update
  to public
using ((organization_id IN ( SELECT organizations.id
   FROM public.organizations
  WHERE ((organizations.owner_id = auth.uid()) OR (organizations.organization_members @> jsonb_build_array(jsonb_build_object('member_uid', (auth.uid())::text)))))))
with check ((organization_id IN ( SELECT organizations.id
   FROM public.organizations
  WHERE ((organizations.owner_id = auth.uid()) OR (organizations.organization_members @> jsonb_build_array(jsonb_build_object('member_uid', (auth.uid())::text)))))));



  create policy "Users can update their notifications"
  on "public"."notifications"
  as permissive
  for update
  to public
using ((organization_id IN ( SELECT notifications.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));



  create policy "Users can view their organization notifications"
  on "public"."notifications"
  as permissive
  for select
  to public
using ((organization_id IN ( SELECT notifications.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));



  create policy "Users can insert onboarding for their organization"
  on "public"."onboarding"
  as permissive
  for insert
  to authenticated
with check ((organization_id IN ( SELECT organizations.id
   FROM public.organizations
  WHERE (organizations.owner_id = auth.uid()))));



  create policy "Users can update onboarding for their organization"
  on "public"."onboarding"
  as permissive
  for update
  to authenticated
using ((organization_id IN ( SELECT organizations.id
   FROM public.organizations
  WHERE ((organizations.owner_id = auth.uid()) OR ((auth.uid())::text IN ( SELECT jsonb_array_elements_text((organizations.organization_members -> 'member_uid'::text)) AS jsonb_array_elements_text))))));



  create policy "Users can view onboarding for their organization"
  on "public"."onboarding"
  as permissive
  for select
  to authenticated
using ((organization_id IN ( SELECT organizations.id
   FROM public.organizations
  WHERE ((organizations.owner_id = auth.uid()) OR ((auth.uid())::text IN ( SELECT jsonb_array_elements_text((organizations.organization_members -> 'member_uid'::text)) AS jsonb_array_elements_text))))));



  create policy "Users can view payment history in their organization"
  on "public"."payment_history"
  as permissive
  for select
  to authenticated
using ((organization_id IN ( SELECT organizations.id
   FROM public.organizations
  WHERE (organizations.owner_id = auth.uid()))));



  create policy "Admins can delete any profile"
  on "public"."profiles"
  as permissive
  for delete
  to public
using ((EXISTS ( SELECT 1
   FROM public.profiles profiles_1
  WHERE ((profiles_1.id = auth.uid()) AND (profiles_1.role = 'ADMIN'::public.user_role)))));



  create policy "Admins can update any profile"
  on "public"."profiles"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.profiles profiles_1
  WHERE ((profiles_1.id = auth.uid()) AND (profiles_1.role = 'ADMIN'::public.user_role)))));



  create policy "Admins can view all profiles"
  on "public"."profiles"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.profiles profiles_1
  WHERE ((profiles_1.id = auth.uid()) AND (profiles_1.role = 'ADMIN'::public.user_role)))));



  create policy "Users can update own profile"
  on "public"."profiles"
  as permissive
  for update
  to public
using ((auth.uid() = id))
with check (((auth.uid() = id) AND (role = ( SELECT profiles_1.role
   FROM public.profiles profiles_1
  WHERE (profiles_1.id = auth.uid())))));



  create policy "Users can view referrals in their organization"
  on "public"."referrals"
  as permissive
  for select
  to authenticated
using ((organization_id IN ( SELECT organizations.id
   FROM public.organizations
  WHERE ((organizations.owner_id = auth.uid()) OR (auth.uid() IN ( SELECT (jsonb_array_elements_text(organizations.organization_members))::uuid AS jsonb_array_elements_text))))));



  create policy "Users can view bundles in their organization or universal"
  on "public"."template_bundles"
  as permissive
  for select
  to authenticated
using (((organization_id IN ( SELECT organizations.id
   FROM public.organizations
  WHERE ((organizations.owner_id = auth.uid()) OR ((auth.uid())::text IN ( SELECT jsonb_array_elements_text((organizations.organization_members -> 'member_uid'::text)) AS jsonb_array_elements_text))))) OR (is_universal = true)));



  create policy "Users can view template history in their organization"
  on "public"."template_history"
  as permissive
  for select
  to authenticated
using ((template_id IN ( SELECT templates.id
   FROM public.templates
  WHERE (templates.organization_id IN ( SELECT organizations.id
           FROM public.organizations
          WHERE ((organizations.owner_id = auth.uid()) OR (auth.uid() IN ( SELECT (jsonb_array_elements_text(organizations.organization_members))::uuid AS jsonb_array_elements_text))))))));


CREATE TRIGGER update_app_content_updated_at BEFORE UPDATE ON public.app_content FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_email_templates_updated_at BEFORE UPDATE ON public.email_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_notifications_updated_at BEFORE UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.update_notifications_updated_at();

CREATE TRIGGER update_onboarding_updated_at BEFORE UPDATE ON public.onboarding FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_template_bundles_updated_at BEFORE UPDATE ON public.template_bundles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_templates_updated_at BEFORE UPDATE ON public.templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

drop trigger if exists "on_auth_user_created" on "auth"."users";

drop trigger if exists "on_user_created_create_preferences" on "auth"."users";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER on_user_created_create_preferences AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.create_default_system_preferences();


