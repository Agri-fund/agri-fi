resource "google_container_cluster" "agri_fi" {
  name     = "agri-fi-${var.environment}"
  location = var.region

  remove_default_node_pool = true
  initial_node_count       = 1

  network    = "default"
  subnetwork = "default"
}

resource "google_container_node_pool" "agri_fi_nodes" {
  name       = "agri-fi-node-pool"
  location   = var.region
  cluster    = google_container_cluster.agri_fi.name
  node_count = 2

  node_config {
    machine_type = "e2-standard-2"
    disk_size_gb = 50
    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform",
    ]
  }
}

resource "google_sql_database_instance" "agri_fi" {
  name             = "agri-fi-db-${var.environment}"
  database_version = "POSTGRES_15"
  region           = var.region

  settings {
    tier = "db-f1-micro"

    backup_configuration {
      enabled    = true
      start_time = "02:00"
    }

    ip_configuration {
      ipv4_enabled = false
      private_network = "projects/${var.project_id}/global/networks/default"
    }
  }

  deletion_protection = true
}

resource "google_sql_database" "agri_fi_db" {
  name     = "agri_fi"
  instance = google_sql_database_instance.agri_fi.name
}
