-- Function to send Slack/Discord webhook alert
CREATE OR REPLACE FUNCTION send_alert_webhook(
    webhook_url TEXT,
    payload JSON
) RETURNS VOID AS $$
BEGIN
    -- Use plpgsql to send HTTP POST request
    -- Note: Requires the `http` extension to be installed in PostgreSQL
    PERFORM http_post(
        webhook_url,
        payload::TEXT,
        'application/json'
    );
EXCEPTION
    WHEN OTHERS THEN
        -- Log the error but don't fail the transaction
        RAISE NOTICE 'Failed to send webhook alert: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to check for unauthorized trade_deal status updates
CREATE OR REPLACE FUNCTION check_unauthorized_trade_deal_update()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if status was changed
    IF OLD.status != NEW.status THEN
        -- Check if there's no valid app_trace_id
        IF NEW.app_trace_id IS NULL OR NEW.app_trace_id = '' THEN
            -- Prepare alert payload (supports both Slack and Discord webhook formats)
            DECLARE
                alert_payload JSON;
                slack_webhook_url TEXT := current_setting('app.slack_webhook_url', true);
                discord_webhook_url TEXT := current_setting('app.discord_webhook_url', true);
            BEGIN
                -- Build payload
                alert_payload := json_build_object(
                    'text', format(
                        ':warning: **Unauthorized Trade Deal Update Detected!**\n' ||
                        'Deal ID: %s\n' ||
                        'Old Status: %s\n' ||
                        'New Status: %s\n' ||
                        'Timestamp: %s',
                        NEW.id,
                        OLD.status,
                        NEW.status,
                        NOW()
                    ),
                    'attachments', json_build_array(
                        json_build_object(
                            'color', 'danger',
                            'fields', json_build_array(
                                json_build_object('title', 'Deal ID', 'value', NEW.id, 'short', true),
                                json_build_object('title', 'Old Status', 'value', OLD.status, 'short', true),
                                json_build_object('title', 'New Status', 'value', NEW.status, 'short', true)
                            )
                        )
                    )
                );

                -- Send to Slack if configured
                IF slack_webhook_url IS NOT NULL AND slack_webhook_url != '' THEN
                    PERFORM send_alert_webhook(slack_webhook_url, alert_payload);
                END IF;

                -- Send to Discord if configured (Discord accepts similar payloads)
                IF discord_webhook_url IS NOT NULL AND discord_webhook_url != '' THEN
                    PERFORM send_alert_webhook(discord_webhook_url, alert_payload);
                END IF;
            END;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on trade_deals table
CREATE TRIGGER unauthorized_trade_deal_update_trigger
AFTER UPDATE OF status ON trade_deals
FOR EACH ROW
EXECUTE FUNCTION check_unauthorized_trade_deal_update();
